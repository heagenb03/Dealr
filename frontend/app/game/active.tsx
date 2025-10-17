import React, { useState } from 'react';
import { StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useGame } from '@/contexts/GameContext';
import { useRouter } from 'expo-router';
import { GameService } from '@/services/gameService';
import { Player, PlayerBalance } from '@/types/game';

export default function ActiveGameScreen() {
  const { activeGame, updateGame, setActiveGame } = useGame();
  const router = useRouter();
  
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [transactionAmount, setTransactionAmount] = useState('');
  const [transactionType, setTransactionType] = useState<'buyin' | 'cashout'>('buyin');
  
  if (!activeGame) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>No active game. Please select or create a game.</Text>
        <TouchableOpacity 
          style={styles.button}
          onPress={() => router.push('/game/new')}
        >
          <Text style={styles.buttonText}>Create New Game</Text>
        </TouchableOpacity>
      </View>
    );
  }
  
  const balances = GameService.calculateBalances(activeGame);
  
  const handleAddPlayer = async () => {
    if (!newPlayerName.trim()) {
      Alert.alert('Error', 'Please enter a player name');
      return;
    }
    
    const player = GameService.addPlayer(activeGame, newPlayerName.trim());
    await updateGame(activeGame);
    setNewPlayerName('');
    setShowAddPlayer(false);
  };
  
  const handleAddTransaction = async () => {
    if (!selectedPlayer) return;
    
    const amount = parseFloat(transactionAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    
    GameService.addTransaction(activeGame, selectedPlayer.id, transactionType, amount);
    await updateGame(activeGame);
    setTransactionAmount('');
    setShowAddTransaction(false);
    setSelectedPlayer(null);
  };
  
  const handleCompleteGame = () => {
    const balances = GameService.calculateBalances(activeGame);
    const validation = GameService.validateGame(balances);
    
    if (!validation.isValid) {
      Alert.alert(
        'Cannot Complete Game',
        `Please fix the following issues:\n\n${validation.errors.join('\n\n')}`,
        [{ text: 'OK' }]
      );
      return;
    }
    
    if (validation.warnings.length > 0) {
      Alert.alert(
        'Game Data Warning',
        `The following issues were detected:\n\n${validation.warnings.join('\n\n')}\n\nDo you want to complete the game anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Complete Anyway',
            style: 'destructive',
            onPress: async () => {
              try {
                GameService.completeGame(activeGame);
                await updateGame(activeGame);
                router.push('/game/summary' as any);
              } catch (error) {
                Alert.alert('Error', 'Failed to complete game. Please try again.');
                console.error('Error completing game:', error);
              }
            }
          }
        ]
      );
      return;
    }
    
    Alert.alert(
      'Complete Game',
      'Are you sure you want to complete this game? You can view settlements afterward.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          onPress: async () => {
            try {
              GameService.completeGame(activeGame);
              await updateGame(activeGame);
              router.push('/game/summary' as any);
            } catch (error) {
              Alert.alert('Error', 'Failed to complete game. Please try again.');
              console.error('Error completing game:', error);
            }
          }
        }
      ]
    );
  };
  
  const openTransactionModal = (player: Player, type: 'buyin' | 'cashout') => {
    setSelectedPlayer(player);
    setTransactionType(type);
    setShowAddTransaction(true);
  };
  
  const getPlayerBalance = (playerId: string): PlayerBalance | undefined => {
    return balances.find(b => b.playerId === playerId);
  };
  
  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Game Info */}
        <View style={styles.header}>
          <Text style={styles.gameTitle}>{activeGame.name}</Text>
          <Text style={styles.gameInfo}>
            {new Date(activeGame.date).toLocaleDateString()}
          </Text>
        </View>
        
        {/* Players List */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Players</Text>
            <TouchableOpacity onPress={() => setShowAddPlayer(true)}>
              <Text style={styles.addButton}>+ Add</Text>
            </TouchableOpacity>
          </View>
          
          {activeGame.players.length === 0 ? (
            <Text style={styles.emptyText}>No players yet. Add players to start.</Text>
          ) : (
            activeGame.players.map(player => {
              const balance = getPlayerBalance(player.id);
              return (
                <View key={player.id} style={styles.playerCard}>
                  <View style={styles.playerInfo}>
                    <Text style={styles.playerName}>{player.name}</Text>
                    {balance && (
                      <View style={styles.playerStats}>
                        <Text style={styles.statText}>
                          Buyins: ${balance.totalBuyins.toFixed(2)}
                        </Text>
                        <Text style={styles.statText}>
                          Cashouts: ${balance.totalCashouts.toFixed(2)}
                        </Text>
                        <Text style={[
                          styles.statText,
                          styles.balanceText,
                          { color: balance.netBalance >= 0 ? '#34C759' : '#FF3B30' }
                        ]}>
                          Balance: {balance.netBalance >= 0 ? '+' : ''}{balance.netBalance.toFixed(2)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.playerActions}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.buyinButton]}
                      onPress={() => openTransactionModal(player, 'buyin')}
                    >
                      <Text style={styles.actionButtonText}>Buy-in</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.cashoutButton]}
                      onPress={() => openTransactionModal(player, 'cashout')}
                    >
                      <Text style={styles.actionButtonText}>Cash Out</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
        
        {/* Complete Game Button */}
        {activeGame.players.length > 1 && activeGame.transactions.length > 0 && (
          <TouchableOpacity 
            style={styles.completeButton}
            onPress={handleCompleteGame}
          >
            <Text style={styles.completeButtonText}>Complete Game & View Settlements</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      
      {/* Add Player Modal */}
      <Modal
        visible={showAddPlayer}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddPlayer(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Player</Text>
            <TextInput
              style={styles.input}
              value={newPlayerName}
              onChangeText={setNewPlayerName}
              placeholder="Player name"
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setNewPlayerName('');
                  setShowAddPlayer(false);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleAddPlayer}
              >
                <Text style={styles.confirmButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      
      {/* Add Transaction Modal */}
      <Modal
        visible={showAddTransaction}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddTransaction(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {transactionType === 'buyin' ? 'Buy-in' : 'Cash Out'} - {selectedPlayer?.name}
            </Text>
            <TextInput
              style={styles.input}
              value={transactionAmount}
              onChangeText={setTransactionAmount}
              placeholder="Amount"
              placeholderTextColor="#666"
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setTransactionAmount('');
                  setShowAddTransaction(false);
                  setSelectedPlayer(null);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleAddTransaction}
              >
                <Text style={styles.confirmButtonText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    marginBottom: 24,
  },
  gameTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  gameInfo: {
    fontSize: 16,
    opacity: 0.7,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  addButton: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 16,
    opacity: 0.5,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
  playerCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#2c2c2e',
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  playerInfo: {
    marginBottom: 12,
  },
  playerName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  playerStats: {
    gap: 4,
  },
  statText: {
    fontSize: 14,
    opacity: 0.7,
  },
  balanceText: {
    fontWeight: '600',
    fontSize: 16,
  },
  playerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buyinButton: {
    backgroundColor: '#FF3B30',
  },
  cashoutButton: {
    backgroundColor: '#34C759',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  completeButton: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
  completeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    margin: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '85%',
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a3c',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#2c2c2e',
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  confirmButton: {
    backgroundColor: '#007AFF',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    opacity: 0.7,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  validationBox: {
    flexDirection: 'row',
    backgroundColor: '#3a0a0a',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  validationWarningBox: {
    backgroundColor: '#3a2a0a',
    borderColor: '#FF9500',
  },
  validationIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  validationContent: {
    flex: 1,
  },
  validationTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#fff',
  },
  validationError: {
    fontSize: 14,
    color: '#FF3B30',
    marginBottom: 4,
    lineHeight: 20,
  },
  validationWarning: {
    fontSize: 14,
    color: '#FF9500',
    marginBottom: 4,
    lineHeight: 20,
  },
});
