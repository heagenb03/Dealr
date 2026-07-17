#include "milp_solver.hpp"
#include <ortools/linear_solver/linear_solver.h>
#include <map>
#include <cmath>
#include <iostream>
#include <sstream>
#include <iomanip>

namespace cashcage {

// Helper function to adjust balances for small imbalances
struct BalanceAdjustmentResult {
    std::vector<PlayerBalance> adjustedBalances;
    std::vector<std::string> warnings;
    bool success;
};

BalanceAdjustmentResult adjustBalancesForSolver(
    const std::vector<PlayerBalance>& balances,
    double tolerance
) {
    const double TOLERANCE = tolerance;
    const double ROUNDING_THRESHOLD = 0.01;

    BalanceAdjustmentResult result;
    result.success = true;

    // Calculate total imbalance
    double totalDebts = 0.0;
    double totalCredits = 0.0;

    for (const auto& balance : balances) {
        if (balance.netBalance < -ROUNDING_THRESHOLD) {
            totalDebts += std::abs(balance.netBalance);
        } else if (balance.netBalance > ROUNDING_THRESHOLD) {
            totalCredits += balance.netBalance;
        }
    }

    double imbalance = totalDebts - totalCredits;

    // If imbalance is within rounding error, no adjustment needed
    if (std::abs(imbalance) <= ROUNDING_THRESHOLD) {
        result.adjustedBalances = balances;
        return result;
    }

    // If imbalance exceeds tolerance, reject
    if (std::abs(imbalance) > TOLERANCE) {
        result.success = false;
        std::ostringstream oss;
        oss << "Game imbalance ($" << std::fixed << std::setprecision(2)
            << std::abs(imbalance) << ") exceeds tolerance ($" << TOLERANCE << ")";
        result.warnings.push_back(oss.str());
        return result;
    }

    // Distribute imbalance proportionally
    result.adjustedBalances = balances;

    // Calculate sum of absolute balances for proportional distribution
    double sumOfAbsBalances = 0.0;
    for (const auto& balance : balances) {
        if (std::abs(balance.netBalance) > ROUNDING_THRESHOLD) {
            sumOfAbsBalances += std::abs(balance.netBalance);
        }
    }

    if (sumOfAbsBalances > ROUNDING_THRESHOLD) {
        // Apply proportional adjustment
        for (auto& balance : result.adjustedBalances) {
            if (std::abs(balance.netBalance) > ROUNDING_THRESHOLD) {
                double proportion = std::abs(balance.netBalance) / sumOfAbsBalances;
                balance.netBalance += imbalance * proportion;
                // Round to 2 decimal places
                balance.netBalance = std::round(balance.netBalance * 100) / 100.0;
            }
        }

        // Add warning message
        std::ostringstream oss;
        oss << "Balances adjusted by $" << std::fixed << std::setprecision(2)
            << std::abs(imbalance) << " to resolve imbalance (distributed proportionally)";
        result.warnings.push_back(oss.str());
    }

    return result;
}

// Round balances to dollar increments, with biggest winner absorbing error
std::vector<PlayerBalance> roundBalancesToDollars(
    const std::vector<PlayerBalance>& balances,
    int increment = 5  // Round to $5 by default
) {
    const double ROUNDING_THRESHOLD = 0.01;
    std::vector<PlayerBalance> rounded = balances;

    // Round all balances to nearest increment
    for (auto& balance : rounded) {
        if (std::abs(balance.netBalance) > ROUNDING_THRESHOLD) {
            double roundedValue = std::round(balance.netBalance / increment) * increment;
            balance.netBalance = roundedValue;
        } else {
            balance.netBalance = 0.0;
        }
    }

    // Calculate rounding error
    double totalError = 0.0;
    for (const auto& balance : rounded) {
        totalError += balance.netBalance;
    }

    // If there's a rounding error, adjust the biggest winner
    if (std::abs(totalError) > ROUNDING_THRESHOLD) {
        // Find the player with the largest positive balance (biggest winner)
        size_t biggestWinnerIdx = 0;
        double maxWin = 0.0;

        for (size_t i = 0; i < rounded.size(); ++i) {
            if (rounded[i].netBalance > maxWin) {
                maxWin = rounded[i].netBalance;
                biggestWinnerIdx = i;
            }
        }

        // Adjust biggest winner to absorb the error
        if (maxWin > 0) {
            rounded[biggestWinnerIdx].netBalance -= totalError;
            // Round to nearest increment again
            rounded[biggestWinnerIdx].netBalance =
                std::round(rounded[biggestWinnerIdx].netBalance / increment) * increment;
        }
    }

    return rounded;
}

MILPResult solveMILP(
    const std::vector<PlayerBalance>& balances,
    std::optional<int> maxTransfersPerPlayer,
    std::optional<double> minTransferAmount,
    std::optional<double> cashRoundingUnit,
    std::optional<double> imbalanceTolerance
) {
    using namespace operations_research;

    MILPResult result;

    // Step 1: Adjust balances for imbalance if needed
    auto adjustmentResult = adjustBalancesForSolver(balances, imbalanceTolerance.value_or(2.50));

    if (!adjustmentResult.success) {
        result.warnings = adjustmentResult.warnings;
        return result;
    }

    result.warnings = adjustmentResult.warnings;

    // Step 2: Round to the requested cash unit for whole-bill payments.
    // unit <= 0 means "Exact" — skip rounding entirely (cent-precise transfers).
    const double unit = cashRoundingUnit.value_or(5.0);
    std::vector<PlayerBalance> roundedBalances;

    if (unit > 0.0) {
        roundedBalances = roundBalancesToDollars(
            adjustmentResult.adjustedBalances, static_cast<int>(unit));

        bool wasRounded = false;
        for (size_t i = 0; i < adjustmentResult.adjustedBalances.size(); ++i) {
            if (std::abs(adjustmentResult.adjustedBalances[i].netBalance -
                         roundedBalances[i].netBalance) > 0.01) {
                wasRounded = true;
                break;
            }
        }
        if (wasRounded) {
            std::ostringstream oss;
            oss << "Balances rounded to $" << static_cast<int>(unit)
                << " increments for easier cash payments";
            result.warnings.push_back(oss.str());
        }
    } else {
        roundedBalances = adjustmentResult.adjustedBalances;  // Exact: no rounding
    }

    const auto& adjustedBalances = roundedBalances;

    // Separate debtors and creditors
    std::vector<int> debtorIdx, creditorIdx;
    for (size_t i = 0; i < adjustedBalances.size(); ++i) {
        if (adjustedBalances[i].netBalance < -0.01) {
            debtorIdx.push_back(i);
        } else if (adjustedBalances[i].netBalance > 0.01) {
            creditorIdx.push_back(i);
        }
    }

    // Handle edge cases
    if (debtorIdx.empty() || creditorIdx.empty()) {
        return result;
    }

    // Create solver
    std::unique_ptr<MPSolver> solver(MPSolver::CreateSolver("CBC"));
    if (!solver) {
        std::cerr << "Failed to create CBC solver" << std::endl;
        return result;
    }

    // Variables: x[d][c] = amount debtor d pays creditor c
    // Variables: y[d][c] = binary indicator
    std::map<std::pair<int, int>, MPVariable*> x, y;

    // Big-M = sum of all debts
    double M = 0;
    for (int d : debtorIdx) {
        M += std::abs(adjustedBalances[d].netBalance);
    }

    // Create variables
    for (int d : debtorIdx) {
        for (int c : creditorIdx) {
            x[{d, c}] = solver->MakeNumVar(
                0, M,
                "x_" + std::to_string(d) + "_" + std::to_string(c)
            );
            y[{d, c}] = solver->MakeBoolVar(
                "y_" + std::to_string(d) + "_" + std::to_string(c)
            );
        }
    }

    // Constraints: each debtor pays exactly their debt
    for (int d : debtorIdx) {
        double debt = std::abs(adjustedBalances[d].netBalance);
        MPConstraint* ct = solver->MakeRowConstraint(debt, debt);
        for (int c : creditorIdx) {
            ct->SetCoefficient(x[{d, c}], 1);
        }
    }

    // Constraints: each creditor receives exactly their credit
    for (int c : creditorIdx) {
        double credit = adjustedBalances[c].netBalance;
        MPConstraint* ct = solver->MakeRowConstraint(credit, credit);
        for (int d : debtorIdx) {
            ct->SetCoefficient(x[{d, c}], 1);
        }
    }

    // Linking constraints: x[d][c] <= M * y[d][c]
    for (int d : debtorIdx) {
        for (int c : creditorIdx) {
            MPConstraint* ct = solver->MakeRowConstraint(
                -solver->infinity(), 0
            );
            ct->SetCoefficient(x[{d, c}], 1);
            ct->SetCoefficient(y[{d, c}], -M);
        }
    }

    // Optional: min transfer amount constraint
    if (minTransferAmount.has_value() && *minTransferAmount > 0.01) {
        for (int d : debtorIdx) {
            for (int c : creditorIdx) {
                MPConstraint* ct = solver->MakeRowConstraint(
                    0, solver->infinity()
                );
                ct->SetCoefficient(x[{d, c}], 1);
                ct->SetCoefficient(y[{d, c}], -*minTransferAmount);
            }
        }
    }

    // Optional: max transfers per player
    if (maxTransfersPerPlayer.has_value() && *maxTransfersPerPlayer > 0) {
        // Max transfers from each debtor
        for (int d : debtorIdx) {
            MPConstraint* ct = solver->MakeRowConstraint(0, *maxTransfersPerPlayer);
            for (int c : creditorIdx) {
                ct->SetCoefficient(y[{d, c}], 1);
            }
        }
        // Max transfers to each creditor
        for (int c : creditorIdx) {
            MPConstraint* ct = solver->MakeRowConstraint(0, *maxTransfersPerPlayer);
            for (int d : debtorIdx) {
                ct->SetCoefficient(y[{d, c}], 1);
            }
        }
    }

    // Objective: minimize number of transfers
    MPObjective* objective = solver->MutableObjective();
    for (int d : debtorIdx) {
        for (int c : creditorIdx) {
            objective->SetCoefficient(y[{d, c}], 1);
        }
    }
    objective->SetMinimization();

    // Solve
    const MPSolver::ResultStatus result_status = solver->Solve();

    if (result_status != MPSolver::OPTIMAL &&
        result_status != MPSolver::FEASIBLE) {
        std::cerr << "No solution found. Status: " << result_status << std::endl;
        return result;
    }

    // Extract results
    for (int d : debtorIdx) {
        for (int c : creditorIdx) {
            double amount = x[{d, c}]->solution_value();
            if (amount > 0.01) {
                result.settlements.push_back({
                    adjustedBalances[d].playerName,
                    adjustedBalances[c].playerName,
                    std::round(amount * 100) / 100.0
                });
            }
        }
    }

    return result;
}

}
