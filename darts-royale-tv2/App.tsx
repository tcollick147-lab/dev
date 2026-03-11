import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { RootStackParamList } from "./src/types/navigation";

import LobbyScreen from "./src/screens/LobbyScreen";
import SetupScreen from "./src/screens/SetupScreen";
import MatchSetupScreen from "./src/screens/MatchSetupScreen";
import GolfSetupScreen from "./src/screens/GolfSetupScreen";
import GolfHandicapDetailScreen from "./src/screens/GolfHandicapDetailScreen";
import CricketSetupScreen from "./src/screens/CricketSetupScreen";
import KillerSetupScreen from "./src/screens/KillerSetupScreen";

import MatchGameScreen from "./src/screens/MatchGameScreen";
import GolfGameScreen from "./src/screens/GolfGameScreen";
import CricketGameScreen from "./src/screens/CricketGameScreen";
import KillerGameScreen from "./src/screens/KillerGameScreen";
import GameResultsDetailScreen from "./src/screens/GameResultsDetailScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Lobby">
        <Stack.Screen name="Lobby" component={LobbyScreen} />

        <Stack.Screen name="Setup" component={SetupScreen} />

        <Stack.Screen name="MatchSetup" component={MatchSetupScreen} />
        <Stack.Screen name="GolfSetup" component={GolfSetupScreen} />
        <Stack.Screen name="GolfHandicapDetail" component={GolfHandicapDetailScreen} />
        <Stack.Screen name="CricketSetup" component={CricketSetupScreen} />
        <Stack.Screen name="KillerSetup" component={KillerSetupScreen} />

        <Stack.Screen name="MatchGame" component={MatchGameScreen} options={{ headerShown: false }} />
        <Stack.Screen name="GolfGame" component={GolfGameScreen} options={{ headerShown: false }} />
        <Stack.Screen name="CricketGame" component={CricketGameScreen} options={{ headerShown: false }} />
        <Stack.Screen name="GameResultsDetail" component={GameResultsDetailScreen} options={{ title: "Results" }} />
        <Stack.Screen
          name="KillerGame"
          options={{ headerShown: false }}
        >
          {(props) => <KillerGameScreen {...props} key={props.route.params?.gameKey ?? "killer"} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
