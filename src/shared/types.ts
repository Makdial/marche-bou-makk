import type { Params } from './i18n';

export type Role = 'buyer' | 'vendor' | 'conductor' | 'admin' | 'gp';
export type UserStatus = 'pending' | 'active' | 'suspended';
export type OrderStatus =
  | 'placed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'rejected'
  | 'cancelled';
export type PaymentMethod = 'mobile_money' | 'cash';
export type PaymentStatus = 'paid' | 'due' | 'refunded';
export type VehicleType = 'moto' | 'bicycle' | 'car' | 'van';
export type AlertAudience = 'vendors' | 'buyers' | 'conductors';

export interface Point {
  lat: number;
  lng: number;
}

export interface Store {
  id: number;
  ownerId: number;
  name: string;
  description: string | null;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  website: string | null;
  bannerUrl: string | null;
  openTime: string | null;
  closeTime: string | null;
  status: UserStatus;
}

export interface ConductorProfile {
  userId: number;
  vehicle: VehicleType;
  address: string | null;
  isOnline: boolean;
  lat: number | null;
  lng: number | null;
  locationUpdatedAt: string | null;
}

export interface GpProfile {
  userId: number;
  country: string | null;
  internationalPhone: string | null;
  senegalPhone: string | null;
  dropoffAddress: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
}

export interface GpShipment {
  id: number;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
  photoUrl: string | null;
  weightKg: number;
  priceCents: number;
  status: 'registered' | 'picked_up' | 'delivered';
  proofPhotoUrl: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface Me {
  id: number;
  role: Role;
  status: UserStatus;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  store: Store | null;
  conductor: ConductorProfile | null;
  gp: GpProfile | null;
}

export interface Category {
  id: number;
  name: string;
}

export interface ProductSummary {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: number | null;
  categoryName: string | null;
  minPriceCents: number;
  offerCount: number;
  inStockOffers: number;
}

export interface BuyerOffer {
  offerId: number;
  productId: number;
  productName: string;
  imageUrl: string | null;
  storeId: number;
  storeName: string;
  storeAddress: string;
  priceCents: number;
  stock: number;
}

export interface ProductDetail extends ProductSummary {
  offers: BuyerOffer[];
  watching: boolean;
}

export interface VendorOffer {
  offerId: number;
  productId: number;
  productName: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: number | null;
  categoryName: string | null;
  priceCents: number;
  stock: number;
  isActive: boolean;
  otherSellers: number;
  updatedAt: string;
}

export interface QuoteLine {
  offerId: number;
  productId: number;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface QuoteGroup {
  storeId: number;
  storeName: string;
  lines: QuoteLine[];
  subtotalCents: number;
  totalCents: number;
  distanceKm: number | null;
  etaMinutes: number | null;
}

export interface Quote {
  groups: QuoteGroup[];
  subtotalCents: number;
  totalCents: number;
}

export interface OrderItem {
  id: number;
  offerId: number | null;
  productId: number;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderEvent {
  status: OrderStatus;
  messageKey: string | null;
  params: Params;
  message: string;
  createdAt: string;
}

export interface OrderView {
  id: number;
  checkoutId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotalCents: number;
  transportFeeCents: number;
  storeTransportCents: number;
  totalCents: number;
  distanceKm: number;
  etaMinutes: number | null;
  store: { id: number; name: string; address: string; lat: number; lng: number; phone: string | null };
  buyer: { id: number; name: string; phone: string | null };
  dropoff: { name: string; phone: string | null; address: string; lat: number; lng: number; notes: string | null } | null;
  conductor: {
    id: number;
    name: string;
    vehicle: VehicleType;
    phone: string | null;
    lat: number | null;
    lng: number | null;
    locationUpdatedAt: string | null;
  } | null;
  items: OrderItem[];
  events: OrderEvent[];
  vendorPayoutCents: number | null;
  commissionCents: number | null;
  conductorEarningCents: number | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  arrivedPickupAt: string | null;
  arrivedDropoffAt: string | null;
  deliveryPhotoUrl: string | null;
}

export interface ConductorJob {
  id: number;
  status: OrderStatus;
  storeName: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  tripKm: number;
  distanceToPickupKm: number | null;
  earningCents: number;
  itemCount: number;
  etaMinutes: number;
  createdAt: string;
}

export interface ConductorOverview {
  profile: ConductorProfile;
  active: OrderView | null;
  jobs: ConductorJob[];
  jobsNote: string | null;
  stats: {
    deliveriesTotal: number;
    deliveredToday: number;
    earningsTotalCents: number;
    earningsTodayCents: number;
  };
}

export interface VendorStats {
  ordersToday: number;
  openOrders: number;
  deliveredTotal: number;
  revenueCents: number;
  productCount: number;
  lowStockCount: number;
  soldOutCount: number;
}

export interface AdminStats {
  users: Record<Role, number>;
  pendingVendors: number;
  pendingConductors: number;
  ordersByStatus: Record<OrderStatus, number>;
  gmvCents: number;
  commissionCents: number;
  deliveredCount: number;
  onlineConductors: number;
  openJobs: number;
  activeDeliveries: number;
  lastSevenDays: { day: string; orders: number; totalCents: number }[];
}

export interface AdminUserRow {
  id: number;
  role: Role;
  status: UserStatus;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  storeName: string | null;
  vehicle: VehicleType | null;
  isOnline: boolean | null;
  gpCountry: string | null;
  gpDropoff: string | null;
  gpInternationalPhone: string | null;
  gpSenegalPhone: string | null;
}

export interface AlertItem {
  id: number;
  productId: number | null;
  productName: string | null;
  title: string;
  body: string;
  audience: AlertAudience[];
  recipients: number;
  createdByName: string | null;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  // Translation keys and their params: each app renders the text in its own language.
  titleKey: string | null;
  bodyKey: string | null;
  params: Params;
  // English text, or the typed text of an admin alert.
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface Settings {
  commissionPercent: number;
  baseDeliveryFeeCents: number;
  perKmFeeCents: number;
  dispatchRadiusKm: number;
  lowStockThreshold: number;
}

export interface PublicGp {
  id: number;
  name: string;
  country: string | null;
  address: string | null;
  lat: number;
  lng: number;
}

export interface PublicStore {
  id: number;
  name: string;
  description: string | null;
  address: string;
  lat: number;
  lng: number;
  bannerUrl: string | null;
  website: string | null;
  openTime: string | null;
  closeTime: string | null;
  productCount: number;
}

export interface MapStore {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  status: UserStatus;
}

export interface MapConductor {
  id: number;
  name: string;
  vehicle: VehicleType;
  lat: number;
  lng: number;
  online: boolean;
  busy: boolean;
  orderId: number | null;
  updatedAt: string | null;
}

export interface MapOrder {
  id: number;
  status: OrderStatus;
  storeName: string;
  storeLat: number;
  storeLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  conductorId: number | null;
}

export interface AdminMap {
  stores: MapStore[];
  conductors: MapConductor[];
  orders: MapOrder[];
}

export interface VendorMap {
  store: { name: string; address: string; lat: number; lng: number };
  conductors: {
    id: number;
    name: string;
    vehicle: VehicleType;
    lat: number;
    lng: number;
    orderId: number;
    status: OrderStatus;
    updatedAt: string | null;
  }[];
}

export interface ChatPerson {
  id: number;
  name: string;
  role: Role;
  storeName: string | null;
  phone: string | null;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderId: number;
  body: string;
  imageUrl: string | null;
  createdAt: string;
}

export interface ChatConversation {
  id: number;
  other: ChatPerson;
  lastMessage: ChatMessage | null;
  unread: number;
  updatedAt: string;
}

// Sent over the live stream as the "chat" event to both participants.
export interface ChatEvent {
  conversationId: number;
  messageId: number;
  senderId: number;
  senderName: string;
  body: string;
  imageUrl: string | null;
}

export type PlanId = 'trial' | 'starter' | 'growth' | 'pro';

export interface VendorPlan {
  plan: PlanId;
  sellsUntil: string | null;
  daysLeft: number;
  selling: boolean;
  productCount: number;
  productLimit: number | null;
  transportSharePercent: number;
  priceCents: number;
  trialDays: number;
}

export interface AdminSubscription {
  storeId: number;
  storeName: string;
  ownerName: string;
  plan: PlanId;
  sellsUntil: string | null;
  daysLeft: number;
  selling: boolean;
  productCount: number;
  productLimit: number | null;
}

export interface StoreOffer {
  offerId: number;
  productId: number;
  productName: string;
  imageUrl: string | null;
  description: string | null;
  priceCents: number;
  stock: number;
  isActive: boolean;
}

export interface StoreProfile {
  id: number;
  name: string;
  description: string | null;
  address: string;
  phone: string | null;
  website: string | null;
  bannerUrl: string | null;
  openTime: string | null;
  closeTime: string | null;
  lat: number;
  lng: number;
  productCount: number;
  offers: StoreOffer[];
}

export interface PublicSettings {
  currency: string;
  center: Point;
  baseDeliveryFeeCents: number;
  perKmFeeCents: number;
}
