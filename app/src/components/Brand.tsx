import { BRAND } from '../brand';

export function BrandLockup() {
  return <div className="product-brand">
    <div className="product-brand-line"><span className="product-wordmark">{BRAND.name}</span><span className="product-attribution">{BRAND.attribution}</span></div>
    <p className="product-purpose">{BRAND.purpose}</p>
    <p className="product-descriptor">{BRAND.descriptor}</p>
  </div>;
}

export function BrandStatement() {
  return <section className="product-statement" aria-label="About 2EP">
    <div><p className="product-eyebrow">{BRAND.name} {BRAND.attribution}</p><h2>{BRAND.purpose}</h2><p className="product-descriptor">{BRAND.descriptor}</p></div>
    <span className="product-statement-mark" aria-hidden="true">{BRAND.name}</span>
  </section>;
}
