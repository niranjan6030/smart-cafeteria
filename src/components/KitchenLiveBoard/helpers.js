export const MAX_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024; // sanity cap on the file staff picks, pre-compression
export const MAX_DATA_URI_LENGTH = 700_000; // safety margin under Firestore's 1MB per-document limit
export const IMAGE_MAX_DIMENSION = 480;
export const IMAGE_JPEG_QUALITY = 0.72;

// No Firebase Storage bucket exists for this project (would require the Blaze billing plan just
// to provision one) — so product photos are compressed client-side and stored directly as a
// base64 data URI on the product document instead. Firestore caps a whole document at 1MB;
// resizing to ~480px and re-encoding as JPEG keeps typical food photos in the tens-of-KB range,
// comfortably under that limit.
export function compressImageToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the selected image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > IMAGE_MAX_DIMENSION) {
          height = Math.round((height * IMAGE_MAX_DIMENSION) / width);
          width = IMAGE_MAX_DIMENSION;
        } else if (height > IMAGE_MAX_DIMENSION) {
          width = Math.round((width * IMAGE_MAX_DIMENSION) / height);
          height = IMAGE_MAX_DIMENSION;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUri = canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
        if (dataUri.length > MAX_DATA_URI_LENGTH) {
          reject(new Error("Even after compression this image is too large — please pick a simpler photo."));
          return;
        }
        resolve(dataUri);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// The 6 exact stall names — must match Firestore `stallName` values exactly.
export const STALLS = ["Falcon Veg", "Fresheteria", "Mingos", "Break Time", "Surf & Turf", "Bakery"];
export const CATEGORIES = ["Mains", "Snacks", "Drinks", "Desserts", "Other"];
export const PAGE_SIZE = 8;

export const money = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN")}`;
// NOTE: orders store their arrival time as `created_at` (snake_case) — the timestamp field this
// file used to read, `createdAt`, is never actually written anywhere, so the old "oldest first"
// sort and time display were silently no-ops. Fixed throughout this rewrite.
export const orderCreatedMs = (order) => order.created_at?.toDate?.()?.getTime() || 0;
export const formatTime = (value) =>
  value?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "--:--";

// ─── Theme tokens: dark cyber-terminal (default) vs light day-shift mode. Kept as a single
// lookup so every component below stays a plain consumer of `t.xxx` instead of branching on
// darkMode individually. Palette matches the light/dark brand colors already used in
// UserMenu.jsx (orange accent + cream in light, teal accent + navy in dark).
export function getTheme(dark) {
  return {
    page: dark ? "bg-[#001724] text-[#37c8be]" : "bg-[#fffaf2] text-stone-700",
    // Fully opaque — sharp, flat sticky bar rather than a translucent glass one.
    headerBg: dark ? "bg-[#001724]" : "bg-white",
    // Structural dividers/borders are now neutral tinted hairlines (not brand-colored) so the
    // accent (teal/orange) stays reserved for things that carry meaning — active tab, focus ring,
    // SLA state — instead of bleeding into every plain rule on the page.
    headerBorder: dark ? "border-white/[0.06]" : "border-black/[0.06]",
    // Flat by design — used for repeated list items (Kanban order cards) where a heavy ambient
    // shadow per-card would turn a dense, scannable column into visual noise.
    panel: dark ? "border-white/[0.06] bg-[#00202f]" : "border-black/[0.06] bg-white",
    // Same surface, with an ambient tinted shadow — reserved for singular, prominent sections
    // (Queue Analytics, Demand Forecast) where elevation helps them read as "the important panel."
    panelElevated: dark
      ? "border-white/[0.06] bg-[#00202f] shadow-[0_1px_2px_rgba(0,0,0,0.4),0_16px_32px_-20px_rgba(55,200,190,0.15)]"
      : "border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_32px_-20px_rgba(239,111,46,0.15)]",
    panelAlt: dark ? "border-white/[0.06] bg-[#001c29]" : "border-black/[0.06] bg-orange-50",
    divider: dark ? "border-white/[0.06]" : "border-black/[0.06]",
    heading: dark ? "text-white" : "text-[#241a12]",
    // Ink tinted off a warm dark brown instead of generic Tailwind stone-* in light mode, so
    // secondary text still reads as "this app's ink, dimmed" rather than an unrelated gray.
    label: dark ? "text-[#37c8be]/55" : "text-[#241a12]/40",
    labelStrong: dark ? "text-[#37c8be]/75" : "text-[#241a12]/55",
    body: dark ? "text-[#37c8be]/75" : "text-[#241a12]/70",
    accent: dark ? "text-[#37c8be]" : "text-[#ef6f2e]",
    accentBg: dark ? "bg-[#37c8be]" : "bg-[#ef6f2e]",
    accentBgHover: dark ? "hover:bg-[#4de0d5]" : "hover:bg-[#d95f22]",
    accentText: dark ? "text-[#001724]" : "text-white",
    accentBorder: dark ? "border-[#37c8be]/40" : "border-[#ef6f2e]/40",
    inputBg: dark ? "bg-black/30" : "bg-orange-50",
    inputBorder: dark ? "border-[#37c8be]/30" : "border-orange-200",
    inputText: dark ? "text-white" : "text-stone-800",
    // Full static hover/focus class strings — Tailwind's JIT scanner needs literal class names, so
    // these can't be built via `hover:${t.x}` template interpolation at the call site.
    labelHover: dark ? "hover:text-[#37c8be]/75" : "hover:text-[#241a12]/55",
    accentHoverText: dark ? "hover:text-[#37c8be]" : "hover:text-[#ef6f2e]",
    focusRing: dark
      ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37c8be]/50"
      : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ef6f2e]/50",
    dark,
  };
}

// ─── Kitchen alert tone (Web Audio synth, same safe-autoplay pattern as UserMenu.jsx) ──────
export function playOrderAlertTone() {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    [0, 0.16].forEach((delay) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(1046, context.currentTime + delay);
      gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + 0.15);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + delay);
      oscillator.stop(context.currentTime + delay + 0.17);
    });
    setTimeout(() => context.close(), 500);
  } catch (error) {
    console.log("Order alert tone blocked:", error);
  }
}

// ─── Kitchen Order Ticket (KOT) print utility ──────────────────────────────
// All Firestore-sourced strings (item names, stall names, customer display names) are
// HTML-escaped before being written into the ticket document — a crafted Google displayName or
// product name must never be able to inject markup into this window.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function printOrderTicket(order) {
  const printWindow = window.open("", "_blank", "width=380,height=640");
  if (!printWindow) {
    alert("Please allow pop-ups for this site to print the KOT.");
    return;
  }
  const lineItems = order.items?.length
    ? order.items.map((item) => `${item.quantity || 1} x ${escapeHtml(item.name)}`).join("\n")
    : escapeHtml(order.itemName || order.item_name || "Item");

  const html = `<!DOCTYPE html><html><head><title>KOT #${escapeHtml(order.id.slice(-6).toUpperCase())}</title>
    <style>
      body { font-family: 'Courier New', monospace; width: 280px; margin: 0 auto; padding: 18px; color: #000; }
      h1 { font-size: 15px; text-align: center; margin: 0 0 4px; letter-spacing: 0.1em; }
      .meta { font-size: 11px; line-height: 1.5; }
      .divider { border-top: 1px dashed #000; margin: 10px 0; }
      pre { white-space: pre-wrap; font-size: 13px; font-weight: bold; margin: 0; }
      .foot { font-size: 10px; text-align: center; margin-top: 10px; }
    </style>
    </head><body>
      <h1>CHRIST UNIVERSITY CAFETERIA</h1>
      <p class="meta">
        Ticket: #${escapeHtml(order.id.slice(-6).toUpperCase())}<br/>
        Stall: ${escapeHtml(order.stallName || order.shop_name || "-")}<br/>
        Printed: ${new Date().toLocaleString()}
      </p>
      <div class="divider"></div>
      <pre>${lineItems}</pre>
      <div class="divider"></div>
      <p class="meta">Customer: ${escapeHtml(order.studentName || order.student_name || "-")}</p>
      <p class="foot">-- Kitchen Copy --</p>
    </body></html>`;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => printWindow.print();
}
