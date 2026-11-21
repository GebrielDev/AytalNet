import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import HomeScreen from './src/screens/HomeScreen';
import StartTripScreen from './src/screens/StartTripScreen';
import ActiveTripScreen from './src/screens/ActiveTripScreen';
import EndTripScreen from './src/screens/EndTripScreen';
import TripHistoryScreen from './src/screens/TripHistoryScreen';
import PrivacyNotice from './src/components/PrivacyNotice';
import { useColors } from './src/theme';
import ErrorBoundary from './src/components/ErrorBoundary';

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const { driver, loading } = useAuth();
  const c = useColors();

  if (loading) {
    return null;
  }

  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: c.header }, headerTintColor: '#fff', contentStyle: { backgroundColor: c.bg } }}>
      {!driver ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Forgot Password' }} />
          <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: 'Reset Password' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'STS Driver App' }} />
          <Stack.Screen name="StartTrip" component={StartTripScreen} options={{ title: 'Start Trip' }} />
          <Stack.Screen name="ActiveTrip" component={ActiveTripScreen} options={{ title: 'Active Trip', headerBackVisible: false }} />
          <Stack.Screen name="EndTrip" component={EndTripScreen} options={{ title: 'End Trip' }} />
          <Stack.Screen name="TripHistory" component={TripHistoryScreen} options={{ title: 'Trip History' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  const c = useColors();
  const base = c.isDark ? DarkTheme : DefaultTheme;
  return (
    <ErrorBoundary>
    <AuthProvider>
      <NavigationContainer theme={{ ...base, colors: { ...base.colors, background: c.bg, card: c.header } }}>
        <StatusBar style="light" />
        <AppNavigator />
        <PrivacyNotice />
      </NavigationContainer>
    </AuthProvider>
    </ErrorBoundary>
  );
}
