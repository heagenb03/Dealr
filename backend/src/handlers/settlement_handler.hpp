#pragma once

#include <crow.h>
#include <nlohmann/json.hpp>
#include "../models/types.hpp"
#include "../solvers/milp_solver.hpp"
#include "../utils/json_helpers.hpp"

namespace cashcage {

// Helper function to add CORS headers to responses
inline void addCorsHeaders(crow::response& res) {
    res.add_header("Access-Control-Allow-Origin", "*");
    res.add_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.add_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

inline void setupRoutes(crow::SimpleApp& app) {
    // OPTIONS handler for CORS preflight requests
    CROW_ROUTE(app, "/settlements/optimal").methods(crow::HTTPMethod::Options)
        ([]() {
            auto res = crow::response(200);
            addCorsHeaders(res);
            return res;
        });

    CROW_ROUTE(app, "/health").methods(crow::HTTPMethod::Options)
        ([]() {
            auto res = crow::response(200);
            addCorsHeaders(res);
            return res;
        });

    CROW_ROUTE(app, "/").methods(crow::HTTPMethod::Options)
        ([]() {
            auto res = crow::response(200);
            addCorsHeaders(res);
            return res;
        });
    // POST /settlements/optimal endpoint
    CROW_ROUTE(app, "/settlements/optimal")
        .methods(crow::HTTPMethod::Post)
        ([](const crow::request& req) {
            try {
                // Parse request body
                auto body = nlohmann::json::parse(req.body);

                // Parse request
                SettlementRequest request = parseRequest(body);

                // Validate balances
                if (request.balances.empty()) {
                    nlohmann::json error = {
                        {"error", "No player balances provided"},
                        {"statusCode", 400}
                    };
                    auto res = crow::response(400, error.dump());
                    addCorsHeaders(res);
                    return res;
                }

                // Generate request ID
                std::string requestId = generateUUID();

                // Solve MILP
                auto milpResult = solveMILP(
                    request.balances,
                    request.maxTransfersPerPlayer,
                    request.minTransferAmount,
                    request.cashRoundingUnit,
                    request.imbalanceTolerance
                );

                // Build response
                nlohmann::json warningsArray = nlohmann::json::array();
                for (const auto& warning : milpResult.warnings) {
                    warningsArray.push_back(warning);
                }

                nlohmann::json response = {
                    {"settlements", serializeSettlements(milpResult.settlements)},
                    {"algorithm", "server-milp-v1"},
                    {"generatedAt", currentISOTimestamp()},
                    {"requestId", requestId},
                    {"warnings", warningsArray}
                };

                auto res = crow::response(200, response.dump());
                addCorsHeaders(res);
                return res;

            } catch (const nlohmann::json::exception& e) {
                nlohmann::json error = {
                    {"error", "Invalid JSON format"},
                    {"message", e.what()},
                    {"statusCode", 400}
                };
                auto res = crow::response(400, error.dump());
                addCorsHeaders(res);
                return res;
            } catch (const std::exception& e) {
                nlohmann::json error = {
                    {"error", "Internal server error"},
                    {"message", e.what()},
                    {"statusCode", 500}
                };
                auto res = crow::response(500, error.dump());
                addCorsHeaders(res);
                return res;
            }
        });

    // Health check endpoint
    CROW_ROUTE(app, "/health")
        ([](const crow::request&) {
            nlohmann::json response = {
                {"status", "ok"},
                {"service", "cashcage-backend"},
                {"timestamp", currentISOTimestamp()}
            };
            auto res = crow::response(200, response.dump());
            addCorsHeaders(res);
            return res;
        });

    // Root endpoint
    CROW_ROUTE(app, "/")
        ([](const crow::request&) {
            nlohmann::json response = {
                {"service", "Cash Cage Settlement Service"},
                {"version", "1.0.0"},
                {"endpoints", {
                    {{"path", "/settlements/optimal"}, {"method", "POST"}},
                    {{"path", "/health"}, {"method", "GET"}}
                }}
            };
            auto res = crow::response(200, response.dump());
            addCorsHeaders(res);
            return res;
        });
}

}
