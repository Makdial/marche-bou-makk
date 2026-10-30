import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface CartItem {
  offerId: number;
  productId: number;
  productName: string;
  storeId: number;
  storeName: string;
  priceCents: number;
  stock: number;
  quantity: number;
  imageUrl: string | null;
}

export type NewCartItem = Omit<CartItem, 'quantity'>;

interface CartValue {
  items: CartItem[];
  count: number;
  add: (item: NewCartItem, quantity: number) => void;
  setQuantity: (offerId: number, quantity: number) => void;
  remove: (offerId: number) => void;
  clear: () => void;
}

const STORAGE_KEY = 'marche.cart';
const CartContext = createContext<CartValue | null>(null);

function readCart(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(readCart);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const add = useCallback((item: NewCartItem, quantity: number) => {
    if (item.stock <= 0) return;
    setItems((current) => {
      const existing = current.find((line) => line.offerId === item.offerId);
      if (existing) {
        return current.map((line) =>
          line.offerId === item.offerId
            ? { ...line, ...item, quantity: Math.min(item.stock, line.quantity + quantity) }
            : line,
        );
      }
      return [...current, { ...item, quantity: Math.min(item.stock, quantity) }];
    });
  }, []);

  const setQuantity = useCallback((offerId: number, quantity: number) => {
    setItems((current) =>
      current
        .map((line) => (line.offerId === offerId ? { ...line, quantity: Math.min(line.stock, quantity) } : line))
        .filter((line) => line.quantity > 0),
    );
  }, []);

  const remove = useCallback((offerId: number) => {
    setItems((current) => current.filter((line) => line.offerId !== offerId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({
      items,
      count: items.reduce((sum, line) => sum + line.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
    }),
    [items, add, setQuantity, remove, clear],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}
