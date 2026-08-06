import './global.css';
import React, { useEffect } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import * as Notifications from 'expo-notifications';

import { AppProvider, useApp } from './src/store/appStore';
import { AuthProvider, useAuth } from './src/store/authStore';

import HomeScreen from './src/screens/Home';
import ProductsScreen from './src/screens/Products';
import OrdersScreen from './src/screens/Orders';
import SettlementScreen from './src/screens/Settlement';
import StoreScreen from './src/screens/Store';
import ProductFormScreen from './src/screens/ProductForm';
import OrderDetailScreen from './src/screens/OrderDetail';
import QrScanScreen from './src/screens/QrScan';
import ReviewsScreen from './src/screens/Reviews';
import NoticeListScreen from './src/screens/NoticeList';
import NoticeDetailScreen from './src/screens/NoticeDetail';
import CouponRequestScreen from './src/screens/CouponRequest';
import CouponStatusScreen from './src/screens/CouponStatus';
import LoginScreen from './src/screens/Login';
import SignUpScreen from './src/screens/SignUp';
import OnboardingScreen from './src/screens/Onboarding';
import SupportScreen from './src/screens/Support';
import InquiryFormScreen from './src/screens/InquiryForm';
import InquiryListScreen from './src/screens/InquiryList';
import InquiryDetailScreen from './src/screens/InquiryDetail';

import {
  Home,
  Package,
  ClipboardList,
  BarChart2,
  Store,
  Clock,
  LogOut,
} from 'lucide-react-native';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// 푸시 알림(배너) 탭 시 컴포넌트 트리 밖(App 컴포넌트)에서 화면을 이동시키기 위한 참조.
const navigationRef = createNavigationContainerRef();

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
      {/* QR 픽업 스캔 — 카메라 전체화면(탭바 가림) */}
      <Stack.Screen name="QrScan" component={QrScanScreen} options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="Reviews" component={ReviewsScreen} />
      <Stack.Screen name="NoticeList" component={NoticeListScreen} />
      <Stack.Screen name="NoticeDetail" component={NoticeDetailScreen} />
      <Stack.Screen name="CouponRequest" component={CouponRequestScreen} />
      <Stack.Screen name="CouponStatus" component={CouponStatusScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="InquiryForm" component={InquiryFormScreen} />
      <Stack.Screen name="InquiryList" component={InquiryListScreen} />
      <Stack.Screen name="InquiryDetail" component={InquiryDetailScreen} />
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

// 입점 심사 중 화면
function PendingApprovalScreen() {
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top, paddingBottom: insets.bottom + 20 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#FFF8ED', alignItems: 'center', justifyContent: 'center', marginBottom: 28 }}>
          <Clock color="#FF8A3D" size={46} />
        </View>
        <Text style={{ fontSize: 24, fontWeight: '800', color: '#1F2933', textAlign: 'center', lineHeight: 32, marginBottom: 14 }}>
          입점 심사 중입니다
        </Text>
        <Text style={{ fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 24, marginBottom: 6 }}>
          제출하신 정보를 검토하고 있습니다.{'\n'}약 1~2일 내 검토 후 서비스가{'\n'}자동으로 활성화됩니다.
        </Text>
        <View style={{ marginTop: 20, backgroundColor: '#F5F6F7', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14 }}>
          <Text style={{ fontSize: 12, color: '#9AA3AF', textAlign: 'center', lineHeight: 18 }}>
            승인 완료 시 앱이 자동으로 전환됩니다.{'\n'}앱을 계속 열어두실 필요는 없습니다.
          </Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <TouchableOpacity
          onPress={signOut}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 6 }}
        >
          <LogOut color="#C4C9D0" size={16} />
          <Text style={{ color: '#9AA3AF', fontSize: 14 }}>다른 계정으로 로그인</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  // 입점 신청 후 관리자 심사 중(approved 아닌 상태)이면 대기 화면
  if (storeInfo.approvalStatus !== 'approved') return <PendingApprovalScreen />;
  return <RootNavigator />;
}

// 푸시 알림(배너) 탭 시 해당 화면으로 딥링크. data.reference_type 은 report_logs 트리거가
// notifications.reference_type 그대로 실어 보낸다(src/lib/push.js 참고).
function handleNotificationDeepLink(data) {
  if (!data || !navigationRef.isReady()) return;
  if (data.reference_type === 'report' && data.reference_id) {
    navigationRef.navigate('InquiryDetail', { reportId: data.reference_id });
  }
}

function usePushNotificationNavigation() {
  useEffect(() => {
    // 앱이 완전 종료 상태였다가 알림 탭으로 실행된 경우(cold start)
    Notifications.getLastNotificationResponseAsync().then(response => {
      const data = response?.notification?.request?.content?.data;
      if (data) handleNotificationDeepLink(data);
    });
    // 앱이 백그라운드/포그라운드 상태에서 알림을 탭한 경우
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      handleNotificationDeepLink(response.notification.request.content.data);
    });
    return () => sub.remove();
  }, []);
}

export default function App() {
  usePushNotificationNavigation();
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppProvider>
          <NavigationContainer ref={navigationRef}>
            <StatusBar style="auto" />
            <Gate />
          </NavigationContainer>
        </AppProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
