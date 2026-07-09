import './global.css';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator } from 'react-native';

import { AppProvider, useApp } from './src/store/appStore';
import { AuthProvider, useAuth } from './src/store/authStore';

import HomeScreen from './src/screens/Home';
import ProductsScreen from './src/screens/Products';
import OrdersScreen from './src/screens/Orders';
import SettlementScreen from './src/screens/Settlement';
import StoreScreen from './src/screens/Store';
import ProductFormScreen from './src/screens/ProductForm';
import OrderDetailScreen from './src/screens/OrderDetail';
import ReviewsScreen from './src/screens/Reviews';
import NoticeListScreen from './src/screens/NoticeList';
import NoticeDetailScreen from './src/screens/NoticeDetail';
import LoginScreen from './src/screens/Login';
import SignUpScreen from './src/screens/SignUp';
import OnboardingScreen from './src/screens/Onboarding';

import {
  Home,
  Package,
  ClipboardList,
  BarChart2,
  Store,
} from 'lucide-react-native';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabBarIcon({ Icon, color, size, badgeCount }) {
  return (
    <View style={{ position: 'relative' }}>
      <Icon color={color} size={size} />
      {badgeCount > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -8,
            backgroundColor: '#E5484D',
            borderRadius: 8,
            minWidth: 16,
            height: 16,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </Text>
        </View>
      )}
    </View>
  );
}

function MainTabs() {
  const { orders } = useApp();
  const insets = useSafeAreaInsets();
  const newOrderCount = orders.filter(o => o.sellerStatus === 'new').length;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#22A06B',
        tabBarInactiveTintColor: '#9AA3AF',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#E5E7EB',
          borderTopWidth: 1,
          height: 54 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: '홈',
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon Icon={Home} color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Products"
        component={ProductsScreen}
        options={{
          tabBarLabel: '상품관리',
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon Icon={Package} color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Orders"
        component={OrdersScreen}
        options={{
          tabBarLabel: '주문관리',
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon Icon={ClipboardList} color={color} size={size} badgeCount={newOrderCount} />
          ),
        }}
      />
      <Tab.Screen
        name="Settlement"
        component={SettlementScreen}
        options={{
          tabBarLabel: '정산',
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon Icon={BarChart2} color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Store"
        component={StoreScreen}
        options={{
          tabBarLabel: '매장관리',
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon Icon={Store} color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="ProductForm" component={ProductFormScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <Stack.Screen name="Reviews" component={ReviewsScreen} />
      <Stack.Screen name="NoticeList" component={NoticeListScreen} />
      <Stack.Screen name="NoticeDetail" component={NoticeDetailScreen} />
    </Stack.Navigator>
  );
}

function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
    </Stack.Navigator>
  );
}

// 세션 유무에 따라 인증 화면 / 앱 본체를 분기
function Gate() {
  const { session, loading: authLoading } = useAuth();
  const { loading: dataLoading, storeInfo } = useApp();
  const splash = (
    <View style={{ flex: 1, backgroundColor: '#22A06B', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#fff" size="large" />
    </View>
  );
  if (authLoading) return splash;
  if (!session) return <AuthNavigator />;
  // 로그인됐지만 매장 데이터 로딩 중이면 스플래시 유지(화면들의 null 접근 방지)
  if (dataLoading) return splash;
  // 로딩이 끝났는데 매장이 없으면(가입 직후 미프로비저닝) 온보딩으로 유도 — 무한 스플래시 방지
  if (!storeInfo) return <OnboardingScreen />;
  return <RootNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppProvider>
          <NavigationContainer>
            <StatusBar style="auto" />
            <Gate />
          </NavigationContainer>
        </AppProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
