#pragma once

#include <string>
#include <map>
#include <nlohmann/json.hpp>
#include "../models/types.hpp"
#include "../solvers/milp_solver.hpp"
#include "../utils/json_helpers.hpp"

namespace cashcage {

// Framework-agnostic HTTP structures
struct HttpRequest {
    std::string method;
    std::string path;
    std::string body;
    std::map<std::string, std::string> headers;
};

struct HttpResponse {
    int statusCode;
    std::string body;
    std::map<std::string, std::string> headers;

    HttpResponse() : statusCode(200) {}
    HttpResponse(int code) : statusCode(code) {}
    HttpResponse(int code, const std::string& content)
        : statusCode(code), body(content) {}
};

// Helper function to add CORS headers to responses
inline void addCorsHeaders(HttpResponse& res) {
    res.headers["Access-Control-Allow-Origin"] = "*";
    res.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    res.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    res.headers["Content-Type"] = "application/json";
}

// Business logic handlers

inline HttpResponse handleOptionsRequest(const HttpRequest&) {
    HttpResponse res(200);
    addCorsHeaders(res);
    return res;
}

inline HttpResponse handleHealthCheck(const HttpRequest&) {
    nlohmann::json response = {
        {"status", "ok"},
        {"service", "cashcage-backend"},
        {"timestamp", currentISOTimestamp()}
    };

    HttpResponse res(200, response.dump());
    addCorsHeaders(res);
    return res;
}

inline HttpResponse handleRootEndpoint(const HttpRequest&) {
    nlohmann::json response = {
        {"service", "Cash Cage Settlement Service"},
        {"version", "1.0.0"},
        {"endpoints", {
            {{"path", "/settlements/optimal"}, {"method", "POST"}},
            {{"path", "/health"}, {"method", "GET"}}
        }}
    };

    HttpResponse res(200, response.dump());
    addCorsHeaders(res);
    return res;
}

inline HttpResponse handleSettlementOptimal(const HttpRequest& req) {
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
            HttpResponse res(400, error.dump());
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

        HttpResponse res(200, response.dump());
        addCorsHeaders(res);
        return res;

    } catch (const nlohmann::json::exception& e) {
        nlohmann::json error = {
            {"error", "Invalid JSON format"},
            {"message", e.what()},
            {"statusCode", 400}
        };
        HttpResponse res(400, error.dump());
        addCorsHeaders(res);
        return res;
    } catch (const std::exception& e) {
        nlohmann::json error = {
            {"error", "Internal server error"},
            {"message", e.what()},
            {"statusCode", 500}
        };
        HttpResponse res(500, error.dump());
        addCorsHeaders(res);
        return res;
    }
}

// Route dispatcher
inline HttpResponse handleRequest(const HttpRequest& req) {
    // Handle OPTIONS requests (CORS preflight)
    if (req.method == "OPTIONS") {
        return handleOptionsRequest(req);
    }

    // Route based on path and method
    if (req.path == "/health" && req.method == "GET") {
        return handleHealthCheck(req);
    }
    else if (req.path == "/" && req.method == "GET") {
        return handleRootEndpoint(req);
    }
    else if (req.path == "/settlements/optimal" && req.method == "POST") {
        return handleSettlementOptimal(req);
    }
    else {
        nlohmann::json error = {
            {"error", "Not found"},
            {"path", req.path},
            {"method", req.method},
            {"statusCode", 404}
        };
        HttpResponse res(404, error.dump());
        addCorsHeaders(res);
        return res;
    }
}

}
