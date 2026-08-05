/**
 * Inline icon set. Bundling ~1KB of paths beats an icon dependency and keeps
 * stroke weight consistent with the type — everything is 1.6px at 20px.
 */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const GitHubIcon = (props) => (
  <svg {...base} {...props} fill="currentColor" stroke="none">
    <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49
      0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62
      1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07
      0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33
      2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57
      5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
  </svg>
);

export const LinkedInIcon = (props) => (
  <svg {...base} {...props} fill="currentColor" stroke="none">
    <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.65h.05c.53-.95 1.83-1.95
      3.75-1.95 4 0 4.4 2.5 4.4 5.75V21h-4v-5.6c0-1.34-.03-3.06-1.9-3.06-1.9 0-2.2 1.45-2.2 2.96V21h-4V9Z" />
  </svg>
);

export const XIcon = (props) => (
  <svg {...base} {...props} fill="currentColor" stroke="none">
    <path d="M17.53 3h3.05l-6.66 7.61L21.75 21h-6.13l-4.8-6.28L5.32 21H2.27l7.12-8.14L2.25 3h6.29l4.34 5.74L17.53 3Zm-1.07
      16.17h1.69L8.13 4.74H6.31l9.15 14.43Z" />
  </svg>
);

export const MailIcon = (props) => (
  <svg {...base} {...props}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
    <path d="m3 7 8.2 5.6a1.5 1.5 0 0 0 1.6 0L21 7" />
  </svg>
);

export const GlobeIcon = (props) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M2.5 12h19M12 2.5a15 15 0 0 1 0 19 15 15 0 0 1 0-19Z" />
  </svg>
);

export const LinkIcon = (props) => (
  <svg {...base} {...props}>
    <path d="M10 13a4 4 0 0 0 5.66 0l3-3A4 4 0 1 0 13 4.34l-1.5 1.5" />
    <path d="M14 11a4 4 0 0 0-5.66 0l-3 3A4 4 0 1 0 11 19.66l1.5-1.5" />
  </svg>
);

export const ArrowIcon = (props) => (
  <svg {...base} {...props}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ArrowUpRight = (props) => (
  <svg {...base} {...props}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export const ExpandIcon = (props) => (
  <svg {...base} {...props}>
    <path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6" />
  </svg>
);

export const ChevronDown = (props) => (
  <svg {...base} {...props}>
    <path d="m5 8 5 5 5-5" />
  </svg>
);

export const ICON_MAP = {
  github: GitHubIcon,
  linkedin: LinkedInIcon,
  x: XIcon,
  mail: MailIcon,
  globe: GlobeIcon,
  link: LinkIcon,
};

export function SocialIcon({ icon, ...props }) {
  const Component = ICON_MAP[icon] || LinkIcon;
  return <Component {...props} />;
}
