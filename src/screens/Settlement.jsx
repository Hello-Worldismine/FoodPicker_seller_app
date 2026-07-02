import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
  Dimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../store/appStore';
import { TrendingUp, AlertTriangle, ChevronDown, Info, Calendar } from 'lucide-react-native';

const STATUS_FILTERS = [
  { key: 'all',    label: '전체' },
  { key: '정산완료', label: '정산완료' },
  { key: '정산예정', label: '정산예정' },
  { key: '보류',   label: '보류' },
];

function formatPrice(n) {
  return n.toLocaleString('ko-KR') + '원';
}

function getStatusStyle(status) {
  if (status === '정산완료') return { color: '#22A06B', bg: '#E9F8F1' };
  if (status === '정산예정') return { color: '#FF8A3D', bg: '#FFF4ED' };
  if (status === '보류')    return { color: '#E5484D', bg: '#FFF0F0' };
  return { color: '#9AA3AF', bg: '#F5F6F7' };
}

// 이번 주 월~일 범위 반환 (weeksAgo=0: 이번 주, 1: 지난 주)
function getWeekBounds(weeksAgo = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=일
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon - weeksAgo * 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return [mon, sun];
}

function formatWeekLabel(weeksAgo) {
  const [mon, sun] = getWeekBounds(weeksAgo);
  const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(mon)}~${fmt(sun)}`;
}

// 다음 수요일 정산일 계산
function getNextWednesday() {
  const now = new Date();
  const day = now.getDay(); // 0=일,3=수
  const diff = (3 - day + 7) % 7 || 7;
  const wed = new Date(now);
  wed.setDate(now.getDate() + diff);
  return wed;
}

// 정산일 3일 전인지 확인
function isWithin3DaysOfSettlement() {
  const next = getNextWednesday();
  const diff = (next - new Date()) / 86400000;
  return diff <= 3;
}

function formatDate(d) {
  return `${d.getFullYear()}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getDate().toString().padStart(2,'0')}`;
}

// 직접 선택용: 최근 8주 목록 생성
function getWeekOptions() {
  return Array.from({ length: 8 }, (_, i) => ({
    weeksAgo: i + 1,
    label: formatWeekLabel(i + 1),
  }));
}

export default function SettlementScreen() {
  const insets = useSafeAreaInsets();
  const { settlements } = useApp();

  const [period, setPeriod] = useState('this_week');   // 'this_week' | 'last_week' | 'custom'
  const [customWeeksAgo, setCustomWeeksAgo] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [statusDropdownPos, setStatusDropdownPos] = useState({ top: 0, right: 16 });
  const [showWeekPicker, setShowWeekPicker] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // iOS 날짜 직접 선택 (커스텀 기간일 때)
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTarget, setPickerTarget] = useState(null);
  const [pickerValue, setPickerValue] = useState(new Date());
  const [customStart, setCustomStart] = useState(getWeekBounds(1)[0]);
  const [customEnd, setCustomEnd] = useState(getWeekBounds(1)[1]);

  const selectedStatusLabel = STATUS_FILTERS.find(f => f.key === statusFilter)?.label || '전체';
  const nextWed = getNextWednesday();
  const accountLocked = isWithin3DaysOfSettlement();

  // 필터링 기간 계산
  function getPeriodBounds() {
    if (period === 'this_week') return getWeekBounds(0);
    if (period === 'last_week') return getWeekBounds(1);
    if (period === 'custom' && customWeeksAgo != null) return getWeekBounds(customWeeksAgo);
    return [null, null];
  }

  const [periodStart, periodEnd] = getPeriodBounds();

  const filtered = settlements.filter(s => {
    const d = new Date(s.date);
    if (periodStart && d < periodStart) return false;
    if (periodEnd && d > periodEnd) return false;
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    return true;
  });

  const totalSales   = filtered.reduce((s, x) => s + x.amount, 0);
  const totalPlatformFee = filtered.reduce((s, x) => s + (x.platformFee || Math.round(x.fee * 0.8)), 0);
  const totalPgFee   = filtered.reduce((s, x) => s + (x.pgFee || Math.round(x.fee * 0.2)), 0);
  const totalFee     = totalPlatformFee + totalPgFee;
  const totalRefund  = filtered.reduce((s, x) => s + (x.refund || 0), 0);
  const totalNet     = filtered.reduce((s, x) => s + x.settlement, 0);
  const holdCount    = filtered.filter(x => x.status === '보류').length;

  function openStatusDropdown(evt) {
    const { pageY } = evt.nativeEvent;
    const screenHeight = Dimensions.get('window').height;
    const dropdownHeight = STATUS_FILTERS.length * 48;
    const top = pageY + 10 + dropdownHeight > screenHeight ? pageY - dropdownHeight - 6 : pageY + 10;
    setStatusDropdownPos({ top, right: 16 });
    setShowStatusDropdown(true);
  }

  function onPickerChange(event, date) {
    if (Platform.OS === 'android') setShowPicker(false);
    if (date) {
      setPickerValue(date);
      if (pickerTarget === 'start') setCustomStart(date);
      else setCustomEnd(date);
    }
  }

  const weekOptions = getWeekOptions();
  const periodLabel = period === 'this_week'
    ? `이번 주 (${formatWeekLabel(0)})`
    : period === 'last_week'
    ? `지난 주 (${formatWeekLabel(1)})`
    : customWeeksAgo != null
    ? formatWeekLabel(customWeeksAgo)
    : '직접 선택';

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#fff', paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1F2933' }}>정산</Text>
          <TouchableOpacity onPress={() => setShowInfo(true)} style={{ padding: 4 }}>
            <Info color="#9AA3AF" size={20} />
          </TouchableOpacity>
        </View>
        {/* 매주 수요일 지급 안내 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, backgroundColor: '#E9F8F1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
          <Calendar color="#22A06B" size={13} />
          <Text style={{ fontSize: 12, color: '#22A06B', fontWeight: '600' }}>매주 수요일 지급</Text>
          <Text style={{ fontSize: 12, color: '#22A06B' }}>· 다음 정산일: {formatDate(nextWed)}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Summary Card */}
        <View style={{ margin: 16, backgroundColor: '#22A06B', borderRadius: 16, padding: 20, elevation: 2 }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginBottom: 4 }}>
            {periodLabel} 정산 금액
          </Text>
          <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', marginBottom: 18 }}>
            {formatPrice(totalNet)}
          </Text>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>판매금액</Text>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{formatPrice(totalSales)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>플랫폼 수수료</Text>
              <Text style={{ color: '#FECACA', fontSize: 14, fontWeight: '600' }}>-{formatPrice(totalPlatformFee)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>결제(PG) 수수료</Text>
              <Text style={{ color: '#FECACA', fontSize: 14, fontWeight: '600' }}>-{formatPrice(totalPgFee)}</Text>
            </View>
            {totalRefund > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>환불금액</Text>
                <Text style={{ color: '#FECACA', fontSize: 14, fontWeight: '600' }}>-{formatPrice(totalRefund)}</Text>
              </View>
            )}
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 4 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>최종 정산금액</Text>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{formatPrice(totalNet)}</Text>
            </View>
          </View>
        </View>

        {/* 정산 계좌 변경 불가 안내 */}
        {accountLocked && (
          <View style={{ marginHorizontal: 16, marginBottom: 4, backgroundColor: '#FFF4ED', borderWidth: 1, borderColor: '#FFD6B3', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AlertTriangle color="#FF8A3D" size={16} />
            <Text style={{ fontSize: 13, color: '#FF8A3D', fontWeight: '600', flex: 1 }}>
              정산일 3일 전으로 정산 계좌 변경이 불가합니다.
            </Text>
          </View>
        )}

        {/* Hold Alert */}
        {holdCount > 0 && (
          <View style={{ marginHorizontal: 16, marginBottom: 4, backgroundColor: 'rgba(229,72,77,0.06)', borderWidth: 1, borderColor: 'rgba(229,72,77,0.25)', borderRadius: 12, padding: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <AlertTriangle color="#E5484D" size={16} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#E5484D' }}>정산 보류 {holdCount}건</Text>
            </View>
            <Text style={{ fontSize: 12, color: '#E5484D', lineHeight: 18 }}>
              관리자 확인이 필요한 정산 항목이 있습니다. 고객센터에 문의해주세요.
            </Text>
          </View>
        )}

        {/* 필터 행: 이번 주 | 지난 주 | 직접 선택 | 정산상태 ▼ */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 16, marginBottom: 12, gap: 8 }}>
          {[
            { key: 'this_week', label: '이번 주' },
            { key: 'last_week', label: '지난 주' },
            { key: 'custom',    label: '직접 선택' },
          ].map(f => {
            const active = period === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                activeOpacity={1}
                onPress={() => {
                  setPeriod(f.key);
                  if (f.key === 'custom') setShowWeekPicker(true);
                }}
                style={{
                  flex: 1, alignItems: 'center',
                  paddingVertical: 9, borderRadius: 20,
                  backgroundColor: active ? '#22A06B' : '#fff',
                  borderWidth: 1, borderColor: active ? '#22A06B' : '#E5E7EB',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : '#6B7280' }}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {/* 정산상태 드롭다운 */}
          <TouchableOpacity
            activeOpacity={1}
            onPress={(evt) => openStatusDropdown(evt)}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: statusFilter !== 'all' ? '#1F2933' : '#fff',
              borderRadius: 20, paddingHorizontal: 10, paddingVertical: 9,
              borderWidth: 1, borderColor: statusFilter !== 'all' ? '#1F2933' : '#E5E7EB', gap: 3,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: statusFilter !== 'all' ? '#fff' : '#6B7280' }}>
              {selectedStatusLabel}
            </Text>
            <ChevronDown color={statusFilter !== 'all' ? '#fff' : '#9CA3AF'} size={13} />
          </TouchableOpacity>
        </View>

        {/* 선택 기간 표시 */}
        {(period === 'custom' && customWeeksAgo != null) && (
          <TouchableOpacity
            onPress={() => setShowWeekPicker(true)}
            style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={{ fontSize: 13, color: '#374151', fontWeight: '600' }}>
              {formatWeekLabel(customWeeksAgo)} 조회 중
            </Text>
            <Text style={{ fontSize: 12, color: '#22A06B' }}>변경</Text>
          </TouchableOpacity>
        )}

        {/* iOS Date Picker Modal */}
        {showPicker && Platform.OS === 'ios' && (
          <Modal visible transparent animationType="slide">
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
                  <TouchableOpacity onPress={() => setShowPicker(false)}>
                    <Text style={{ color: '#9AA3AF', fontSize: 15 }}>취소</Text>
                  </TouchableOpacity>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: '#1F2933' }}>날짜 선택</Text>
                  <TouchableOpacity onPress={() => setShowPicker(false)}>
                    <Text style={{ color: '#22A06B', fontWeight: '600', fontSize: 15 }}>확인</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={pickerValue}
                  mode="date"
                  display="spinner"
                  onChange={onPickerChange}
                  maximumDate={new Date()}
                  locale="ko-KR"
                />
              </View>
            </View>
          </Modal>
        )}

        {showPicker && Platform.OS === 'android' && (
          <DateTimePicker value={pickerValue} mode="date" display="default" onChange={onPickerChange} maximumDate={new Date()} />
        )}

        {/* Settlement List */}
        <View style={{ paddingHorizontal: 16 }}>
          {filtered.length === 0 ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <View style={{ width: 56, height: 56, backgroundColor: '#F3F4F6', borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <TrendingUp color="#9AA3AF" size={24} />
              </View>
              <Text style={{ color: '#9CA3AF', fontSize: 14 }}>정산 내역이 없습니다</Text>
            </View>
          ) : (
            filtered.map(item => {
              const style = getStatusStyle(item.status);
              const pFee = item.platformFee || Math.round(item.fee * 0.8);
              const gFee = item.pgFee || Math.round(item.fee * 0.2);
              return (
                <View key={item.id} style={{ backgroundColor: '#fff', borderRadius: 14, marginBottom: 12, padding: 16, elevation: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: 12, color: '#9CA3AF' }}>{item.date} · {item.orderId}</Text>
                    <View style={{ backgroundColor: style.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: style.color }}>{item.status}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#1F2933', marginBottom: 14 }}>
                    {item.productName}
                  </Text>
                  <View style={{ gap: 7 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>판매금액</Text>
                      <Text style={{ fontSize: 13, color: '#374151' }}>{formatPrice(item.amount)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>플랫폼 수수료</Text>
                      <Text style={{ fontSize: 13, color: '#E5484D' }}>-{formatPrice(pFee)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>결제(PG) 수수료</Text>
                      <Text style={{ fontSize: 13, color: '#E5484D' }}>-{formatPrice(gFee)}</Text>
                    </View>
                    {item.refund > 0 && (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 13, color: '#6B7280' }}>환불금액</Text>
                        <Text style={{ fontSize: 13, color: '#E5484D' }}>-{formatPrice(item.refund)}</Text>
                      </View>
                    )}
                    <View style={{ height: 1, backgroundColor: '#F3F4F6', marginVertical: 2 }} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#374151' }}>정산금액</Text>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#22A06B' }}>{formatPrice(item.settlement)}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* 정산상태 드롭다운 Modal */}
      <Modal visible={showStatusDropdown} transparent animationType="none" onRequestClose={() => setShowStatusDropdown(false)}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowStatusDropdown(false)}>
          <View style={{
            position: 'absolute', top: statusDropdownPos.top, right: statusDropdownPos.right,
            backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB',
            elevation: 10, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
            overflow: 'hidden', minWidth: 110,
          }}>
            {STATUS_FILTERS.map((f, i) => {
              const sel = statusFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  activeOpacity={0.8}
                  onPress={() => { setStatusFilter(f.key); setShowStatusDropdown(false); }}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 12,
                    backgroundColor: sel ? '#1F2933' : '#fff',
                    borderTopWidth: i === 0 ? 0 : 1, borderTopColor: '#F3F4F6',
                  }}
                >
                  <Text style={{ fontSize: 14, color: sel ? '#fff' : '#374151', fontWeight: sel ? '600' : '400' }}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 직접 선택 — 주차 선택 Modal */}
      <Modal visible={showWeekPicker} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#1F2933' }}>조회 기간 선택</Text>
              <TouchableOpacity onPress={() => setShowWeekPicker(false)}>
                <Text style={{ color: '#9AA3AF', fontSize: 15 }}>닫기</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: '#9AA3AF', paddingHorizontal: 16, paddingVertical: 10 }}>
              정산은 매주 수요일에 지급됩니다. 조회할 주를 선택하세요.
            </Text>
            {weekOptions.map(opt => {
              const selected = period === 'custom' && customWeeksAgo === opt.weeksAgo;
              return (
                <TouchableOpacity
                  key={opt.weeksAgo}
                  activeOpacity={0.85}
                  onPress={() => { setCustomWeeksAgo(opt.weeksAgo); setPeriod('custom'); setShowWeekPicker(false); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 16, paddingVertical: 14,
                    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
                    backgroundColor: selected ? '#E9F8F1' : '#fff',
                  }}
                >
                  <Text style={{ fontSize: 15, color: selected ? '#22A06B' : '#1F2933', fontWeight: selected ? '700' : '400' }}>
                    {opt.label}
                  </Text>
                  {selected && <Text style={{ fontSize: 13, color: '#22A06B', fontWeight: '600' }}>선택됨</Text>}
                  {!selected && <Text style={{ fontSize: 12, color: '#9AA3AF' }}>{opt.weeksAgo === 1 ? '지난 주' : `${opt.weeksAgo}주 전`}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* 정산 안내 Modal */}
      <Modal visible={showInfo} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1F2933', marginBottom: 16 }}>정산 안내</Text>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Text style={{ color: '#22A06B', fontWeight: '700', fontSize: 14 }}>📅</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2933', marginBottom: 2 }}>매주 수요일 지급</Text>
                  <Text style={{ fontSize: 13, color: '#6B7280', lineHeight: 20 }}>전주 월~일 판매금액에서 수수료를 차감한 금액이 매주 수요일 정산됩니다.</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Text style={{ fontSize: 14 }}>💳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2933', marginBottom: 2 }}>정산 수수료 구성</Text>
                  <Text style={{ fontSize: 13, color: '#6B7280', lineHeight: 20 }}>플랫폼 이용 수수료 + 결제(PG) 수수료가 차감됩니다.</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Text style={{ fontSize: 14 }}>⚠️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#E5484D', marginBottom: 2 }}>계좌 변경 제한</Text>
                  <Text style={{ fontSize: 13, color: '#6B7280', lineHeight: 20 }}>정산일(수요일) 기준 3일 전부터는 정산 계좌를 변경할 수 없습니다.</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={{ marginTop: 20, backgroundColor: '#22A06B', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
              onPress={() => setShowInfo(false)}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
