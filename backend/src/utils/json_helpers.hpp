#pragma once

#include <nlohmann/json.hpp>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <random>
#include "../models/types.hpp"

namespace cashcage {

inline std::string generateUUID() {
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<> dis(0, 15);
    static std::uniform_int_distribution<> dis2(8, 11);

    std::stringstream ss;
    ss << std::hex;
    for (int i = 0; i < 8; i++) ss << dis(gen);
    ss << "-";
    for (int i = 0; i < 4; i++) ss << dis(gen);
    ss << "-4";
    for (int i = 0; i < 3; i++) ss << dis(gen);
    ss << "-";
    ss << dis2(gen);
    for (int i = 0; i < 3; i++) ss << dis(gen);
    ss << "-";
    for (int i = 0; i < 12; i++) ss << dis(gen);

    return ss.str();
}

inline std::string currentISOTimestamp() {
    auto now = std::chrono::system_clock::now();
    auto itt = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()
    ) % 1000;

    std::ostringstream ss;
    ss << std::put_time(std::gmtime(&itt), "%Y-%m-%dT%H:%M:%S");
    ss << '.' << std::setfill('0') << std::setw(3) << ms.count() << 'Z';

    return ss.str();
}

inline PlayerBalance parsePlayerBalance(const nlohmann::json& j) {
    PlayerBalance balance;
    balance.playerId = j.at("playerId").get<std::string>();
    balance.playerName = j.at("playerName").get<std::string>();
    balance.totalBuyins = j.at("totalBuyins").get<double>();
    balance.totalCashouts = j.at("totalCashouts").get<double>();
    balance.netBalance = j.at("netBalance").get<double>();
    return balance;
}

inline SettlementRequest parseRequest(const nlohmann::json& body) {
    SettlementRequest request;

    if (body.contains("balances") && body["balances"].is_array()) {
        for (const auto& balanceJson : body["balances"]) {
            request.balances.push_back(parsePlayerBalance(balanceJson));
        }
    }

    if (body.contains("settings") && body["settings"].is_object()) {
        const auto& settings = body["settings"];

        if (settings.contains("maxTransfersPerPlayer") &&
            settings["maxTransfersPerPlayer"].is_number()) {
            request.maxTransfersPerPlayer = settings["maxTransfersPerPlayer"].get<int>();
        }

        if (settings.contains("minTransferAmount") &&
            settings["minTransferAmount"].is_number()) {
            request.minTransferAmount = settings["minTransferAmount"].get<double>();
        }

        if (settings.contains("cashRoundingUnit") &&
            settings["cashRoundingUnit"].is_number()) {
            request.cashRoundingUnit = settings["cashRoundingUnit"].get<double>();
        }

        if (settings.contains("imbalanceTolerance") &&
            settings["imbalanceTolerance"].is_number()) {
            request.imbalanceTolerance = settings["imbalanceTolerance"].get<double>();
        }
    }

    return request;
}

inline nlohmann::json serializeSettlement(const Settlement& settlement) {
    return {
        {"from", settlement.from},
        {"to", settlement.to},
        {"amount", settlement.amount}
    };
}

inline nlohmann::json serializeSettlements(const std::vector<Settlement>& settlements) {
    nlohmann::json result = nlohmann::json::array();
    for (const auto& settlement : settlements) {
        result.push_back(serializeSettlement(settlement));
    }
    return result;
}

}
