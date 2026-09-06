import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function NoteIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 4.75A1.75 1.75 0 0 1 6.75 3h10.5A1.75 1.75 0 0 1 19 4.75v14.5A1.75 1.75 0 0 1 17.25 21H6.75A1.75 1.75 0 0 1 5 19.25z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></Icon>;
}

export function EditIcon(props: IconProps) {
  return <Icon {...props}><path d="m14.7 5.3 4 4M4 20l3.9-.8L19 8.1a1.8 1.8 0 0 0 0-2.6l-.5-.5a1.8 1.8 0 0 0-2.6 0L4.8 16.1z"/></Icon>;
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return <Icon {...props} fill={filled ? "currentColor" : "none"}><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></Icon>;
}

export function MenuIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 7h16M4 12h16M4 17h16"/></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 5v14M5 12h14"/></Icon>;
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18"/></Icon>;
}

export function LockIcon(props: IconProps) {
  return <Icon {...props}><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m7 10 5 5 5-5"/></Icon>;
}

export function LinkIcon(props: IconProps) {
  return <Icon {...props}><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></Icon>;
}

export function FileTextIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></Icon>;
}

export function AddDocumentIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 15h6M12 12v6"/></Icon>;
}

export function HistoryIcon(props: IconProps) {
  return <Icon {...props}><path d="M4.8 8A8 8 0 1 1 4 12"/><path d="M4 5v3h3M12 8v4l2.5 1.5"/></Icon>;
}

export function HeartIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return <Icon {...props} fill={filled ? "currentColor" : "none"}><path d="M20.8 5.8a5.1 5.1 0 0 0-7.2 0L12 7.4l-1.6-1.6a5.1 5.1 0 0 0-7.2 7.2l1.6 1.6L12 21l7.2-6.4 1.6-1.6a5.1 5.1 0 0 0 0-7.2z"/></Icon>;
}

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></Icon>;
}

export function FolderIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></Icon>;
}
