// Tapak mark: a support chat bubble carrying a footprint ("tapak" means footprint). Rendered as one
// <img> so the mark is a single element in the layout.
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M14 6h36a10 10 0 0 1 10 10v24a10 10 0 0 1-10 10H28l-11 9c-1.3 1-3 .1-3-1.5V50a10 10 0 0 1-10-10V16A10 10 0 0 1 14 6Z" fill="#FF5A1F"/>
<g fill="#FFFFFF" transform="rotate(14 32 28)">
<ellipse cx="32" cy="30" rx="6.2" ry="9.6"/>
<ellipse cx="32.6" cy="43.5" rx="4.6" ry="3.6"/>
<ellipse cx="25.6" cy="17.6" rx="2.2" ry="2.6"/>
<ellipse cx="30" cy="15.2" rx="2.1" ry="2.5"/>
<ellipse cx="34.4" cy="15.4" rx="1.9" ry="2.3"/>
<ellipse cx="38.2" cy="17.4" rx="1.7" ry="2.1"/>
</g>
</svg>`;

export const LOGO_URI = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;

export function Logo({ size = 32 }: { size?: number }) {
  return <img src={LOGO_URI} width={size} height={size} alt="" className="logo-img" />;
}
