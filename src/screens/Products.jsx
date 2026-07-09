import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Image,
  Alert,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useApp, PRODUCT_STATUS } from '../store/appStore';
import { Plus, Minus, Edit2, MoreHorizontal, Trash2, AlertTriangle } from 'lucide-react-native';

const TABS = [
  { key: 'all',     label: '전체' },
  { key: 'selling', label: '판매중' },
  { key: 'soldout', label: '품절' },
  { key: 'paused',  label: '판매중지' },
  { key: 'hidden',  label: '반려' },
];

function formatPickupTime(start, end) {
  if (!start) return '';
  const fmt = iso => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };
  return `${fmt(start)}~${fmt(end)}`;
}

function formatExpiry(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  return isToday ? `오늘 ${time}` : time;
}

function isExpired(isoDate) {
  return isoDate && new Date(isoDate) < new Date();
}

export default function ProductsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { storeInfo, products, updateProductStock, updateProductStatus, deleteProduct } = useApp();

  const [activeTab, setActiveTab] = useState('all');
  const [actionModal, setActionModal] = useState(null);
  const [menuProduct, setMenuProduct] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 16 });
  // 소비기한 만료·자동 가격인하는 서버 스케줄러(pg_cron)가 처리 → 클라이언트 tick 제거.

  const filtered = activeTab === 'all'
    ? products
    : products.filter(p => p.status === activeTab);

  function getTabCount(key) {
    if (key === 'all') return products.length;
    return products.filter(p => p.status === key).length;
  }

  function handleStatusAction(product, action) {
    setActionModal({ product, action });
  }

  function handleResume(product) {
    if (product.stock === 0) {
      Alert.alert('수량 설정 필요', '판매를 재개하려면 먼저 수량을 설정해주세요.');
    } else {
      updateProductStatus(product.id, 'selling');
    }
  }

  function openMenu(product, evt) {
    const { pageY } = evt.nativeEvent;
    const screenHeight = Dimensions.get('window').height;
    const popupHeight = 52;
    const top = pageY + 10 + popupHeight > screenHeight ? pageY - popupHeight - 6 : pageY + 10;
    setMenuPos({ top, right: 16 });
    setMenuProduct(product);
  }

  function handleDelete(product) {
    setMenuProduct(null);
    Alert.alert(
      '상품 삭제',
      `"${product.name}" 상품을\n삭제하시겠습니까?\n\n삭제된 상품은 복구할 수 없습니다.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => deleteProduct(product.id) },
      ]
    );
  }

  function confirmAction() {
    if (!actionModal) return;
    updateProductStatus(actionModal.product.id, actionModal.action);
    setActionModal(null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#fff', paddingTop: insets.top + 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#1F2933', marginBottom: 12 }}>상품관리</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {TABS.map(tab => {
              const count = getTabCount(tab.key);
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  activeOpacity={1}
                  onPress={() => setActiveTab(tab.key)}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 12, paddingVertical: 9,
                    borderBottomWidth: active ? 2 : 0,
                    borderBottomColor: '#22A06B',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: active ? '#22A06B' : '#9AA3AF' }}>
                    {tab.label}
                  </Text>
                  {count > 0 && (
                    <View style={{
                      marginLeft: 4, borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1,
                      backgroundColor: active ? '#E9F8F1' : '#F5F6F7',
                    }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: active ? '#22A06B' : '#9AA3AF' }}>
                        {count}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1, paddingTop: 12, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        {/* 판매 일시중지 배너 */}
        {storeInfo.isSellingPaused && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF4ED', borderWidth: 1, borderColor: '#FFD6B3', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12 }}>
            <AlertTriangle color="#FF8A3D" size={18} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FF8A3D' }}>오늘 판매 일시중지 중</Text>
              <Text style={{ fontSize: 12, color: '#FF8A3D', marginTop: 2 }}>홈 화면에서 판매를 재개할 수 있습니다.</Text>
            </View>
          </View>
        )}
        {filtered.length === 0 ? (
          <View style={{ paddingVertical: 64, alignItems: 'center' }}>
            <Text style={{ color: '#9CA3AF', fontSize: 15 }}>상품이 없습니다</Text>
          </View>
        ) : (
          filtered.map(product => {
            const statusInfo = PRODUCT_STATUS[product.status];
            const expiryStr = formatExpiry(product.expiryDate);
            const expired = isExpired(product.expiryDate);
            return (
              <View
                key={product.id}
                style={{ backgroundColor: '#fff', borderRadius: 14, marginBottom: 12, overflow: 'hidden', elevation: 1 }}
              >
                <View style={{ padding: 14 }}>
                  {/* Top row: emoji + info + ... menu */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: '#F5F6F7', overflow: 'hidden', marginRight: 12, alignItems: 'center', justifyContent: 'center' }}>
                      {product.thumbnail ? (
                        <Image source={{ uri: product.thumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: 28 }}>{product.emoji}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <View style={{ backgroundColor: statusInfo?.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 11, fontWeight: '600', color: statusInfo?.color }}>{statusInfo?.label}</Text>
                        </View>
                      </View>
                      <Text style={{ fontWeight: '700', color: '#1F2933', fontSize: 16, marginBottom: 3 }}>{product.name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontWeight: '700', color: '#22A06B', fontSize: 15 }}>{product.salePrice.toLocaleString()}원</Text>
                        <Text style={{ color: '#9CA3AF', fontSize: 12, textDecorationLine: 'line-through' }}>{product.originalPrice.toLocaleString()}원</Text>
                        <Text style={{ color: '#FF8A3D', fontSize: 12, fontWeight: '600' }}>{product.discountRate}%</Text>
                      </View>
                    </View>
                    {/* ... 메뉴 버튼 */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={(evt) => openMenu(product, evt)}
                      style={{ padding: 4, marginLeft: 4 }}
                    >
                      <MoreHorizontal color="#9AA3AF" size={20} />
                    </TouchableOpacity>
                  </View>

                  {/* Pickup & Expiry */}
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 10, marginBottom: 10 }}>
                    <Text style={{ fontSize: 12, color: '#9CA3AF' }}>
                      픽업 {formatPickupTime(product.pickupStart, product.pickupEnd)}
                    </Text>
                    <Text style={{ fontSize: 12, color: expired ? '#E5484D' : '#9CA3AF' }}>
                      소비기한 {expiryStr}
                    </Text>
                  </View>

                  {/* 반려 사유 */}
                  {product.status === 'hidden' && product.rejectReason && (
                    <View style={{ backgroundColor: '#FFF0F0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#E5484D', marginBottom: 3 }}>반려 사유</Text>
                      <Text style={{ fontSize: 12, color: '#E5484D', lineHeight: 18 }}>{product.rejectReason}</Text>
                    </View>
                  )}

                  {/* 가격 인하 Progress Bar (판매중 + reductionAmount 있을 때) */}
                  {product.status === 'selling' && product.reductionAmount && product.startPrice && product.floorPrice && (
                    (() => {
                      const progressPct = Math.min(1, Math.max(0,
                        (product.startPrice - product.salePrice) / (product.startPrice - product.floorPrice)
                      ));
                      const atFloor = product.salePrice <= product.floorPrice;
                      // 다음 자동 인하 예정 시각 = (마지막 인하 or 등록 시각) + 인하 간격 — 서버 pg_cron 기준.
                      const baseMs = new Date(product.lastReducedAt || product.createdAt).getTime();
                      const remainMin = Math.max(0, Math.round((baseMs + (product.intervalMinutes || 30) * 60000 - Date.now()) / 60000));
                      const hours = Math.floor(remainMin / 60);
                      const mins = remainMin % 60;
                      const nextLabel = atFloor
                        ? '최저가 도달'
                        : remainMin <= 0
                          ? '곧 인하'
                          : `다음 인하까지 ${hours > 0 ? `${hours}시간 ` : ''}${mins}분`;
                      return (
                        <View style={{ marginBottom: 10 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={{ fontSize: 11, color: '#9AA3AF' }}>
                              가격 인하 진행 중 ({product.salePrice.toLocaleString()}원)
                            </Text>
                            <Text style={{ fontSize: 11, color: '#22A06B', fontWeight: '600' }}>
                              {nextLabel}
                            </Text>
                          </View>
                          <View style={{ height: 4, backgroundColor: '#E9F8F1', borderRadius: 2 }}>
                            <View style={{ height: 4, borderRadius: 2, backgroundColor: '#22A06B', width: `${progressPct * 100}%` }} />
                          </View>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                            <Text style={{ fontSize: 10, color: '#9AA3AF' }}>{product.startPrice.toLocaleString()}원</Text>
                            <Text style={{ fontSize: 10, color: '#9AA3AF' }}>{product.floorPrice.toLocaleString()}원</Text>
                          </View>
                        </View>
                      );
                    })()
                  )}

                  {/* Badges */}
                  {product.badges && product.badges.filter(b => b !== '품절').length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {product.badges.filter(b => b !== '품절').map(badge => (
                        <View key={badge} style={{ backgroundColor: '#FFF4ED', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ color: '#FF8A3D', fontSize: 11, fontWeight: '600' }}>{badge}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* 소비기한 초과 자동 판매중지 안내 */}
                  {product.status === 'paused' && product.pauseReason === 'expiry' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF4ED', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }}>
                      <AlertTriangle color="#FF8A3D" size={14} />
                      <Text style={{ fontSize: 12, color: '#FF8A3D', flex: 1, lineHeight: 18 }}>
                        소비기한이 지나 자동으로 판매 중지 처리되었습니다. 재등록 시 소비기한을 업데이트해 주세요.
                      </Text>
                    </View>
                  )}

                  {/* Stock Controls */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F6F7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}>
                    <Text style={{ fontSize: 14, color: '#374151', fontWeight: '600' }}>남은 수량</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {product.stock === 0 && product.status === 'soldout' && (
                        <Text style={{ fontSize: 12, color: '#FF8A3D', fontWeight: '600' }}>자동 품절 처리됨</Text>
                      )}
                      <TouchableOpacity
                        onPress={() => updateProductStock(product.id, -1)}
                        style={{ width: 30, height: 30, backgroundColor: '#fff', borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EB' }}
                      >
                        <Minus color="#374151" size={13} />
                      </TouchableOpacity>
                      <Text style={{ fontWeight: '700', color: '#1F2933', fontSize: 17, width: 24, textAlign: 'center' }}>{product.stock}</Text>
                      <TouchableOpacity
                        onPress={() => updateProductStock(product.id, 1)}
                        style={{ width: 30, height: 30, backgroundColor: '#fff', borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EB' }}
                      >
                        <Plus color="#374151" size={13} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {product.status === 'selling' && (
                      <>
                        <TouchableOpacity
                          style={{ flex: 1, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                          onPress={() => handleStatusAction(product, 'paused')}
                        >
                          <Text style={{ color: '#6B7280', fontSize: 13, fontWeight: '600' }}>판매 중지</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: '#1F2933', borderRadius: 10, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                          onPress={() => navigation.navigate('ProductForm', { productId: product.id })}
                        >
                          <Edit2 color="#fff" size={13} />
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>수정</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {product.status === 'soldout' && (
                      <>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: '#22A06B', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                          onPress={() => handleResume(product)}
                        >
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>판매 재개</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: '#1F2933', borderRadius: 10, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                          onPress={() => navigation.navigate('ProductForm', { productId: product.id })}
                        >
                          <Edit2 color="#fff" size={13} />
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>수정</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {product.status === 'paused' && (
                      <>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: '#22A06B', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                          onPress={() => handleResume(product)}
                        >
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>판매 재개</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: '#1F2933', borderRadius: 10, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                          onPress={() => navigation.navigate('ProductForm', { productId: product.id })}
                        >
                          <Edit2 color="#fff" size={13} />
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>수정</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {product.status === 'hidden' && (
                      <TouchableOpacity
                        style={{ flex: 1, backgroundColor: '#E5484D', borderRadius: 10, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}
                        onPress={() => navigation.navigate('ProductForm', { productId: product.id })}
                      >
                        <Edit2 color="#fff" size={13} />
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>수정 후 재등록</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          })
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Floating Add Button */}
      <TouchableOpacity
        style={{ position: 'absolute', right: 16, bottom: insets.bottom + 16, width: 56, height: 56, backgroundColor: '#22A06B', borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 6 }}
        onPress={() => navigation.navigate('ProductForm')}
      >
        <Plus color="#fff" size={28} />
      </TouchableOpacity>

      {/* ... 팝오버 메뉴 */}
      <Modal visible={!!menuProduct} transparent animationType="none" onRequestClose={() => setMenuProduct(null)}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setMenuProduct(null)}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={e => e.stopPropagation?.()}
            style={{
              position: 'absolute',
              top: menuPos.top,
              right: menuPos.right,
              backgroundColor: '#fff',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#F0F0F0',
              elevation: 12,
              shadowColor: '#000',
              shadowOpacity: 0.15,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              overflow: 'hidden',
              minWidth: 140,
            }}
          >
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => handleDelete(menuProduct)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 15 }}
            >
              <Trash2 color="#E5484D" size={16} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#E5484D' }}>삭제하기</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Action Confirm Modal */}
      <Modal visible={!!actionModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2933', marginBottom: 8, textAlign: 'center' }}>
              판매 중지
            </Text>
            <Text style={{ color: '#6B7280', fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 22 }}>
              {`"${actionModal?.product?.name}" 상품의\n판매를 중지하시겠습니까?`}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={() => setActionModal(null)}
              >
                <Text style={{ color: '#374151', fontWeight: '600', fontSize: 15 }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#22A06B', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={confirmAction}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>확인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
