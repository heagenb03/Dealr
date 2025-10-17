import { StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useGame } from '@/contexts/GameContext';
import { useRouter } from 'expo-router';
import { GameService } from '@/services/gameService';

export default function HomeScreen() {
  const { games, activeGame, setActiveGame, deleteGame } = useGame();
  const router = useRouter();
  
  const activeGames = games.filter(g => g.status === 'active');
  const completedGames = games.filter(g => g.status === 'completed');
  
  const handleGamePress = async (gameId: string) => {
    await setActiveGame(gameId);
    const game = games.find(g => g.id === gameId);
    if (game?.status === 'active') {
      router.push('/game/active' as any);
    } else {
      router.push('/game/summary' as any);
    }
  };
  
  const handleDeleteGame = (gameId: string, gameName: string) => {
    Alert.alert(
      'Delete Game',
      `Are you sure you want to delete "${gameName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: () => deleteGame(gameId)
        }
      ]
    );
  };
  
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };
  
  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Active Games Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Games</Text>
          {activeGames.length === 0 ? (
            <Text style={styles.emptyText}>No active games. Start a new game!</Text>
          ) : (
            activeGames.map(game => (
              <TouchableOpacity
                key={game.id}
                style={styles.gameCard}
                onPress={() => handleGamePress(game.id)}
                onLongPress={() => handleDeleteGame(game.id, game.name)}
              >
                <View style={styles.gameCardHeader}>
                  <Text style={styles.gameCardTitle}>{game.name}</Text>
                  <Text style={styles.gameCardDate}>{formatDate(game.date)}</Text>
                </View>
                <Text style={styles.gameCardInfo}>
                  {game.players.length} players • {game.transactions.length} transactions
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
        
        {/* Completed Games Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Completed Games</Text>
          {completedGames.length === 0 ? (
            <Text style={styles.emptyText}>No completed games yet</Text>
          ) : (
            completedGames.map(game => (
              <TouchableOpacity
                key={game.id}
                style={[styles.gameCard, styles.completedCard]}
                onPress={() => handleGamePress(game.id)}
                onLongPress={() => handleDeleteGame(game.id, game.name)}
              >
                <View style={styles.gameCardHeader}>
                  <Text style={styles.gameCardTitle}>{game.name}</Text>
                  <Text style={styles.gameCardDate}>{formatDate(game.date)}</Text>
                </View>
                <Text style={styles.gameCardInfo}>
                  {game.players.length} players • ${GameService.generateGameSummary(game).totalPot.toFixed(2)} pot
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
      
      {/* New Game Button */}
      <TouchableOpacity 
        style={styles.newGameButton}
        onPress={() => router.push('/game/new')}
      >
        <Text style={styles.newGameButtonText}>+ New Game</Text>
      </TouchableOpacity>
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    opacity: 0.5,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
  gameCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#2c2c2e',
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  completedCard: {
    opacity: 0.8,
  },
  gameCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  gameCardTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  gameCardDate: {
    fontSize: 14,
    opacity: 0.7,
  },
  gameCardInfo: {
    fontSize: 14,
    opacity: 0.7,
  },
  newGameButton: {
    margin: 16,
    padding: 18,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  newGameButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
