import React from 'react';
import { StyleSheet, ScrollView, TouchableOpacity, Share } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useGame } from '@/contexts/GameContext';
import { useRouter } from 'expo-router';
import { GameService } from '@/services/gameService';

export default function GameSummaryScreen() {
  const { activeGame } = useGame();
  const router = useRouter();
  
  if (!activeGame) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>No active game.</Text>
      </View>
    );
  }
  
  const summary = GameService.generateGameSummary(activeGame);
  
  const handleShare = async () => {
    try {
      let message = `${activeGame.name} - Settlement Summary\n\n`;
      message += `Total Pot: $${summary.totalPot.toFixed(2)}\n\n`;
      message += `Settlements:\n`;
      summary.settlements.forEach(s => {
        message += `• ${s.from} pays ${s.to}: $${s.amount.toFixed(2)}\n`;
      });
      
      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };
  
  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Game Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{activeGame.name}</Text>
          <Text style={styles.subtitle}>
            {new Date(activeGame.date).toLocaleDateString()}
          </Text>
          <View style={styles.totalPotCard}>
            <Text style={styles.totalPotLabel}>Total Pot</Text>
            <Text style={styles.totalPotAmount}>${summary.totalPot.toFixed(2)}</Text>
          </View>
        </View>
        
        {/* Settlements */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💰 Settlements</Text>
          <Text style={styles.sectionSubtitle}>
            Optimized to minimize transactions ({summary.settlements.length} payment{summary.settlements.length !== 1 ? 's' : ''})
          </Text>
          
          {summary.settlements.length === 0 ? (
            <Text style={styles.emptyText}>All balanced! No settlements needed.</Text>
          ) : (
            summary.settlements.map((settlement, index) => (
              <View key={index} style={styles.settlementCard}>
                <View style={styles.settlementInfo}>
                  <Text style={styles.settlementFrom}>{settlement.from}</Text>
                  <Text style={styles.settlementArrow}>→</Text>
                  <Text style={styles.settlementTo}>{settlement.to}</Text>
                </View>
                <Text style={styles.settlementAmount}>
                  ${settlement.amount.toFixed(2)}
                </Text>
              </View>
            ))
          )}
        </View>
        
        {/* Player Balances */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 Final Balances</Text>
          {summary.balances.map(balance => (
            <View key={balance.playerId} style={styles.balanceCard}>
              <View style={styles.balanceInfo}>
                <Text style={styles.balanceName}>{balance.playerName}</Text>
                <View style={styles.balanceDetails}>
                  <Text style={styles.balanceDetail}>
                    Buyins: ${balance.totalBuyins.toFixed(2)}
                  </Text>
                  <Text style={styles.balanceDetail}>
                    Cashouts: ${balance.totalCashouts.toFixed(2)}
                  </Text>
                </View>
              </View>
              <Text style={[
                styles.balanceNet,
                { color: balance.netBalance >= 0 ? '#34C759' : '#FF3B30' }
              ]}>
                {balance.netBalance >= 0 ? '+' : ''}{balance.netBalance.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
      
      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity 
          style={styles.shareButton}
          onPress={handleShare}
        >
          <Text style={styles.shareButtonText}>Share Summary</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.doneButton}
          onPress={() => router.push('/')}
        >
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
    marginBottom: 24,
  },
  totalPotCard: {
    backgroundColor: '#007AFF',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
  },
  totalPotLabel: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
    marginBottom: 8,
  },
  totalPotAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    opacity: 0.5,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
  settlementCard: {
    backgroundColor: '#2c2c2e',
    padding: 20,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settlementInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settlementFrom: {
    fontSize: 16,
    fontWeight: '600',
  },
  settlementArrow: {
    fontSize: 20,
    marginHorizontal: 12,
    opacity: 0.5,
  },
  settlementTo: {
    fontSize: 16,
    fontWeight: '600',
  },
  settlementAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#34C759',
  },
  balanceCard: {
    backgroundColor: '#2c2c2e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceInfo: {
    flex: 1,
  },
  balanceName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  balanceDetails: {
    gap: 4,
  },
  balanceDetail: {
    fontSize: 14,
    opacity: 0.7,
  },
  balanceNet: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  actions: {
    padding: 16,
    gap: 12,
  },
  shareButton: {
    backgroundColor: '#2c2c2e',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  shareButtonText: {
    fontSize: 18,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
