import { QRCodeSVG } from "qrcode.react";
import type { QrNode } from "../lib/types";
import { TYPE_META } from "../lib/types";
import "./BoardQrGallery.css";

type Props = {
  nodes: QrNode[];
  onBack: () => void;
  onUseAsStart: (node: QrNode) => void;
};

/** Shows real scannable QR codes for every board — print or open on another screen. */
export function BoardQrGallery({ nodes, onBack, onUseAsStart }: Props) {
  return (
    <section className="screen flow qr-gallery">
      <div className="topbar">
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <h2>QR boards</h2>
          <p>These are the real QR codes. Print them or open on another phone to scan.</p>
        </div>
      </div>

      <div className="qr-gallery-grid">
        {nodes.map((n) => (
          <article key={n.code} className="qr-card">
            <div className="qr-card-code">
              <QRCodeSVG
                value={n.code}
                size={168}
                level="M"
                includeMargin
                bgColor="#ffffff"
                fgColor="#14201c"
              />
            </div>
            <h3>{n.name}</h3>
            <p className="qr-card-meta">
              {n.code} · {TYPE_META[n.node_type]?.label ?? n.node_type}
            </p>
            <button
              type="button"
              className="qr-use"
              onClick={() => onUseAsStart(n)}
            >
              I am here — start from this board
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
