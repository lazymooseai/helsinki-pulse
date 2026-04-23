/**
 * openExternal — Safari-yhteensopiva ulkoisten linkkien avaus.
 *
 * Lovablen preview-iframe asettaa Cross-Origin-Opener-Policy: same-origin
 * -headerin, mika estaa Safarissa window.open-kutsut "noopener"-modessa
 * ("Navigation was blocked by Cross-Origin-Opener-Policy" -virhe).
 *
 * Ratkaisu: luodaan ohjelmallisesti <a target="_blank"> elementti, klikataan
 * sita ja poistetaan. Tama menee selaimen oman link-handlerin kautta ja
 * kiertaa COOP-rajoituksen. Fallback: navigoi nykyisessa tabissa.
 */
export function openExternal(url: string | undefined | null): void {
  if (!url) return;
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    // Joissain Safari-versioissa elementti pitaa olla DOMissa
    a.style.position = "absolute";
    a.style.left = "-9999px";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    // Viimeinen oljenkorsi: navigoi nykyisessa tabissa
    try {
      window.location.assign(url);
    } catch {
      console.error("openExternal failed:", e);
    }
  }
}
