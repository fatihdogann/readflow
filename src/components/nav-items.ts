export interface NavItem {
  href: string;
  label: string;
}

/** Masaüstü sidebar ve mobil menü aynı veriyi kullanır. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Yeni" },
  { href: "/history", label: "Geçmiş" },
  { href: "/favorites", label: "Favoriler" },
  { href: "/settings", label: "Ayarlar" },
];
