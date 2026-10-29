import { QRCodeSVG } from "qrcode.react";
import type { QrNode } from "../lib/types";
import { TYPE_META, locationBoardLink } from "../lib/types";
import { usePhoneAppBase } from "../hooks/usePhoneAppBase";
import "./BoardQrGallery.css";

type Props = {
  nodes: QrNode[];
  onBack: () => void;
  onUseAsStart: (node: QrNode) => void;
};

/** Shows phone-scannable URL QRs for every board. */
export function BoardQrGallery({ nodes, onBack, onUseAsStart }: Props) {
  const phoneOrigin = usePhoneAppBase();

  return (
    <section className="screen flow qr-gallery">
      <div className="topbar">
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <h2>Kumbh QR boards</h2>
          <p>
            Print these for ghats, akharas, camps, and gates. A phone scan opens
            the visitor guide at that place.
          </p>
        </div>
      </div>

      {nodes.length === 0 && (
        <div className="empty-state">
          <strong>No boards yet</strong>
          <p>
            Boards appear here after a volunteer registers a place. Go back,
            choose “I am a volunteer”, then “Register a mela place”.
          </p>
        </div>
      )}

      <div className="qr-gallery-grid">
        {nodes.map((n) => {
          const link = locationBoardLink(n.code, phoneOrigin);
          return (
            <article key={n.code} className="qr-card">
              <div className="qr-card-code">
                <QRCodeSVG
                  value={link}
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
              <p
                className="qr-card-meta"
                style={{ wordBreak: "break-all", fontSize: "0.7rem" }}
              >
                {link}
              </p>
              <button
                type="button"
                className="qr-use"
                onClick={() => onUseAsStart(n)}
              >
                I am here — start from this board
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
