import React, { useState } from 'react'; 
import { StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useGame } from '@/contexts/GameContext';
import { useRouter } from 'expo-router';

export default function NewGameScreen() {
  const [gameName, setGameName] = useState('');
  const { createGame, setActiveGame } = useGame();
  const router = useRouter();
  
  const handleCreateGame = async () => {
    if (!gameName.trim()) {
      Alert.alert('Error', 'Please enter a game name');
      return;
    }
    
    try {
      const newGame = await createGame(gameName.trim());
      // Game is now automatically set as active in createGame
      router.navigate('/game/active' as any);
    } catch (error) {
      Alert.alert('Error', 'Failed to create game');
      console.error('Error creating game:', error);
    }
  };
  
  const handleCancel = () => {
    router.back();
  };
  
  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Create New Game</Text>
        <Text style={styles.subtitle}>Start tracking your poker night</Text>
        
        <View style={styles.form}>
          <Text style={styles.label}>Game Name</Text>
          <TextInput
            style={styles.input}
            value={gameName}
            onChangeText={setGameName}
            placeholder="e.g., Friday Night Poker"
            placeholderTextColor="#666"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreateGame}
          />
          
          <TouchableOpacity 
            style={styles.createButton}
            onPress={handleCreateGame}
          >
            <Text style={styles.createButtonText}>Create Game</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.cancelButton}
            onPress={handleCancel}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
    marginBottom: 48,
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a3c',
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  cancelButtonText: {
    fontSize: 18,
    fontWeight: '600',
    opacity: 0.7,
  },
});
