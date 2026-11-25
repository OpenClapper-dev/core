import { useEffect, useState } from "react";
import { backupAll, hasPassphrase, restoreNetwork, setPassphrase, takeBack } from "../keyBackup";
import { PASSPHRASE_MIN } from "../bt/keySeal";
import { getMeshNetworks, hasKeys, heldElsewhere, syncMeshNetworks, type MeshNetwork } from "../meshNetworks";
import { log } from "../../../log";
import { Banner, Block, Button, confirm, ErrorText, Header, Hint, PasswordInput, Screen, SectionLabel, toast } from "../../../ui";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Hardware › Key backup (#303, docs/features/hardware.md): the recovery passphrase, and per mesh network where its
 * keys stand: backed up, in use on another phone (take it back), or not on this phone (restore).
 */
export function KeyBackup({ back }: { back: () => void }) {
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => { void syncMeshNetworks().then(refresh); }, []);
  const networks = getMeshNetworks();
  const set = hasPassphrase();
  return (
    <Screen header={<Header title="Key backup" sub="Aputure lights' mesh keys" onBack={back} />}>
      <Passphrase set={set} onSaved={refresh} />
      {networks.length === 0 && <Block><Hint>No mesh network yet: it is made when the first Aputure light is paired.</Hint></Block>}
      {networks.map((n) => <NetworkRow key={n.id} n={n} passphraseSet={set} onChange={refresh} />)}
    </Screen>
  );
}

function Passphrase({ set, onSaved }: { set: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(!set);
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = next !== "" && next.length < PASSPHRASE_MIN;
  const mismatch = again !== "" && again !== next;
  const ready = next.length >= PASSPHRASE_MIN && next === again && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await setPassphrase(next);
      toast(set ? "Passphrase changed; keys backed up again" : "Key backup on");
      setNext(""); setAgain(""); setOpen(false);
      onSaved();
    } catch (e) {
      log("warn", "mesh key backup: passphrase not saved", { error: e });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Block>
      <SectionLabel>Recovery passphrase</SectionLabel>
      {set && !open && (
        <>
          <Hint>Set on this device. Every change to the keys is backed up, sealed with it: the server cannot read them.</Hint>
          <Button kind="secondary" icon="edit" label="Change passphrase" onPress={() => setOpen(true)} />
        </>
      )}
      {open && (
        <>
          {!set && <Banner kind="warn" icon="warning" title="No key backup" meta="If this device is lost or reset, every Aputure light has to be reset and paired again." />}
          <PasswordInput value={next} onChangeText={setNext} editable={!busy} placeholder="Passphrase" autoComplete="new-password" textContentType="newPassword" />
          {short ? <ErrorText>{`Too short: at least ${PASSPHRASE_MIN} characters.`}</ErrorText> : <Hint>{`At least ${PASSPHRASE_MIN} characters. Keep it outside the device: without it, a backup cannot be opened.`}</Hint>}
          <PasswordInput value={again} onChangeText={setAgain} editable={!busy} placeholder="Again" autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void save()} />
          {mismatch && <ErrorText>Not the same as above.</ErrorText>}
          {error && <ErrorText>{error}</ErrorText>}
          <Button icon="lock" label={set ? "Change passphrase" : "Turn on key backup"} busy={busy} disabled={!ready} onPress={() => void save()} />
        </>
      )}
    </Block>
  );
}

function NetworkRow({ n, passphraseSet, onChange }: { n: MeshNetwork; passphraseSet: boolean; onChange: () => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = hasKeys(n.id);
  const elsewhere = heldElsewhere(n);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); onChange(); } catch (e) {
      log("warn", `mesh keys: ${what} failed`, { network: n.id, error: e });
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const restore = () => run("restore", async () => {
    const ok = await confirm({ title: "Move the lights to this device?", body: "The device that had them stops controlling them.", confirmLabel: "Restore" });
    if (!ok) return;
    const r = await restoreNetwork(n, pass);
    if (r === "wrong-passphrase") { setError("Wrong passphrase."); return; }
    if (r === "no-backup") { setError("There is no backup of this network."); return; }
    setPass("");
    toast("Keys restored: this device controls the lights");
  });

  const back = () => run("take back", async () => {
    const ok = await confirm({ title: "Control the lights from this device again?", body: "The other device stops controlling them.", confirmLabel: "Use this device" });
    if (!ok) return;
    await takeBack(n);
    toast("This device controls the lights again");
  });

  return (
    <Block>
      <SectionLabel>{n.name}</SectionLabel>
      {keys && !elsewhere && (
        n.backupAt
          ? <Hint>{`Backed up ${when(n.backupAt)}.`}</Hint>
          : passphraseSet
            ? <>
                <Hint>Not backed up yet: it goes up on the next sync.</Hint>
                <Button kind="secondary" icon="cloud-upload" label="Back up now" busy={busy} onPress={() => void run("backup", () => backupAll(true))} />
              </>
            : <Hint>Not backed up: set a passphrase above.</Hint>
      )}
      {keys && elsewhere && (
        <>
          <Hint>In use on another device, which restored the keys. This device does not control these lights until you take them back.</Hint>
          <Button kind="secondary" icon="mobile" label="Use this device again" busy={busy} onPress={() => void back()} />
        </>
      )}
      {!keys && (n.backupAt
        ? <>
            <Hint>{`The keys are not on this device. A backup from ${when(n.backupAt)} can be restored with the recovery passphrase.`}</Hint>
            <PasswordInput value={pass} onChangeText={setPass} editable={!busy} placeholder="Recovery passphrase" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void restore()} />
            <Button icon="unlock" label="Restore keys" busy={busy} disabled={!pass || busy} onPress={() => void restore()} />
          </>
        : <Hint>The keys are on another device and there is no backup. Turn on key backup there, or reset the lights and pair them again.</Hint>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Block>
  );
}
