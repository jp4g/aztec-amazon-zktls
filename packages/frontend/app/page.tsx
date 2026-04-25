import AttestPurchaseBrowser from "@/components/AttestPurchaseBrowser";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <header>
        <h1>Amazon purchase → zkTLS attestation</h1>
      </header>

      <section className={styles.prereqs}>
        <ol>
          <li>Find the order you want to notarize.</li>
          <li>Copy the order ID.</li>
          <li>Paste it in below.</li>
        </ol>
      </section>

      <AttestPurchaseBrowser />
    </main>
  );
}
