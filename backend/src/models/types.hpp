#pragma once

#include <string>
#include <vector>
#include <optional>

namespace cashcage {

struct PlayerBalance {
    std::string playerId;
    std::string playerName;
    double totalBuyins;
    double totalCashouts;
    double netBalance;
};

struct Settlement {
    std::string from;
    std::string to;
    double amount;
};

struct SettlementRequest {
    std::vector<PlayerBalance> balances;
    std::optional<int> maxTransfersPerPlayer;
    std::optional<double> minTransferAmount;
    std::optional<double> cashRoundingUnit;
    std::optional<double> imbalanceTolerance;
};

struct SettlementResponse {
    std::vector<Settlement> settlements;
    std::string algorithm;
    std::string generatedAt;
    std::string requestId;
    std::vector<std::string> warnings;
};

}
