import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { RootStackParamList } from "./src/types/navigation";
import LobbyScreen from "./src/screens/LobbyScreen";
import SetupScreen from "./src/screens/SetupScreen";
import MatchGameScreen from "./src/screens/MatchGameScreen";
import GolfGameScreen from "./src/screens/GolfGameScreen"; 
// adjust path depending on where the navigator file is


const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Lobby">
        <Stack.Screen name="Lobby" component={LobbyScreen} options={{ title: "Darts Royale" }} />
        <Stack.Screen name="Setup" component={SetupScreen} options={{ title: "Setup" }} />
        <Stack.Screen name="MatchGame" component={MatchGameScreen} options={{ title: "Match" }} />
        <Stack.Screen name="GolfGame" component={GolfGameScreen} />

      </Stack.Navigator>
    </NavigationContainer>
  );
}

