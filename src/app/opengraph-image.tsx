import { ImageResponse } from "next/og";

/**
 * The picture a shared link shows on WhatsApp, Telegram, LinkedIn and X. Every
 * route inherits it. Drawn rather than a file so the words stay in the repo,
 * and kept to plain shapes so it renders the same everywhere.
 */
export const alt = "Rahdari — truck location by vehicle number, from FASTag toll crossings";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #ffffff 0%, #eef4ff 60%, #fff3e8 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "#1558B8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 38,
              fontWeight: 800,
            }}
          >
            R
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#14213d" }}>Rahdari</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 68, fontWeight: 800, color: "#14213d", lineHeight: 1.08 }}>
            Where is your truck?
          </div>
          <div style={{ fontSize: 68, fontWeight: 800, color: "#FF8515", lineHeight: 1.08 }}>
            Check by vehicle number.
          </div>
          <div style={{ fontSize: 30, color: "#4a5a72", marginTop: 8 }}>
            Recorded FASTag toll crossings, truck tracking and movement alerts.
          </div>
        </div>

        <div style={{ fontSize: 26, color: "#1558B8", fontWeight: 600 }}>rahdari.in</div>
      </div>
    ),
    size,
  );
}
