export interface NavItem {
  href: string;
  label: string;
}

/** Masaüstü sidebar ve mobil menü aynı veriyi kullanır. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Yeni ekle" },
  { href: "/history", label: "Geçmiş" },
  { href: "/notes", label: "Notlar" },
  { href: "/favorites", label: "Favoriler" },
  { href: "/highlights", label: "Vurgular" },
  { href: "/settings", label: "Ayarlar" },
];
