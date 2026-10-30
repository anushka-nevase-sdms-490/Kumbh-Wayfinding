import { useEffect, useState } from "react";
import { useI18n } from "../i18n/context";
import {
  MAP_BYTES,
  MAP_FILE_COUNT,
  MapStorageFullError,
  downloadOfflineMap,
  freeStorageBytes,
  offlineMapSupported,
  savedMapFiles,
} from "../lib/mapCache";

type MapState =
  | { kind: "checking" }
  | { kind: "missing"; done: number }
  | { kind: "downloading"; done: number; total: number }
  | { kind: "ready" }
  | { kind: "error"; done: number; noSpace?: boolean };

const SIZE_MB = Math.max(1, Math.round(MAP_BYTES / 1e6));

/** Home-screen card: save the offline map on the phone before going to the mela. */
export function OfflineMapCard() {
  const { t } = useI18n();
  const [state, setState] = useState<MapState>({ kind: "checking" });
  /** Free space the browser reports (MB), shown when it looks too small. */
  const [freeMb, setFreeMb] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void savedMapFiles().then((n) => {
      if (cancelled) return;
      setState(n >= MAP_FILE_COUNT ? { kind: "ready" } : { kind: "missing", done: n });
    });
    void freeStorageBytes().then((b) => {
      if (!cancelled && b !== null) setFreeMb(Math.floor(b / 1e6));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!offlineMapSupported() || state.kind === "checking") return null;

  if (state.kind === "ready") {
    return <p className="map-save ready">{t("map.saved")}</p>;
  }

  if (state.kind === "downloading") {
    const pct = Math.floor((state.done / Math.max(1, state.total)) * 100);
    return (
      <div className="map-save" aria-live="polite">
        <p>{t("map.saving", { pct })}</p>
        <progress max={state.total} value={state.done} />
      </div>
    );
  }

  const start = async () => {
    setState({ kind: "downloading", done: 0, total: MAP_FILE_COUNT });
    try {
      await downloadOfflineMap((done, total) => setState({ kind: "downloading", done, total }));
      setState({ kind: "ready" });
    } catch (e) {
      setState({ kind: "error", done: await savedMapFiles(), noSpace: e instanceof MapStorageFullError });
    }
  };

  return (
    <div className="map-save">
      <p>
        {state.kind === "error" && state.noSpace
          ? t("map.noSpace", { mb: SIZE_MB })
          : state.kind === "error"
          ? t("map.stopped")
          : state.done > 0
            ? t("map.partial")
            : t("map.intro")}
      </p>
      {freeMb !== null && freeMb < SIZE_MB * 1.2 && <p className="map-save-warn">{t("map.lowSpace", { free: freeMb, mb: SIZE_MB })}</p>}
      <button type="button" className="btn soft" onClick={() => void start()}>
        {state.kind === "missing" && state.done === 0
          ? t("map.download", { mb: SIZE_MB })
          : t("map.continue")}
      </button>
    </div>
  );
}
