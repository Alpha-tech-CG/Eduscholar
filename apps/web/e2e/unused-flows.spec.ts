import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  createConfirmedUser,
  strongPassword,
  uniqueEmail,
  waitForEmailHtml,
} from "./support/auth";

// Parcours du service d'authentification que l'application n'utilise pas : un
// appel direct peut encore les déclencher. Leurs courriels ne portent ni lien
// ni code : ils ne mènent à rien.

function directClient(keyName = "SUPABASE_PUBLISHABLE_KEY") {
  const url = process.env.SUPABASE_URL;
  const key = process.env[keyName];
  if (!url || !key) throw new Error("Variables de l'instance locale absentes");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Le message ne doit contenir aucun lien, ni rien qui ressemble à un jeton ou à un code. */
function expectInert(html: string) {
  expect(html).toContain("ne contient ni lien ni");
  expect(html).not.toMatch(/href\s*=/i);
  expect(html).not.toMatch(/https?:\/\//i);
  // Aucune adresse : le message ne répète rien de ce qu'un tiers a saisi.
  expect(html).not.toContain("@");
  // Ni code à chiffres, ni empreinte : aucune suite de six chiffres ou de vingt
  // signes hexadécimaux. Les styles en ligne portent des couleurs chiffrées :
  // ils sont écartés.
  const body = html.replace(/style="[^"]*"/g, "");
  expect(body).not.toMatch(/\d{6,}/);
  expect(body).not.toMatch(/[0-9a-f]{20,}/i);
}

test.describe("parcours d'authentification non utilisés", () => {
  // Deux navigateurs, mais un seul envoi par adresse : le service limite les courriels.
  test.describe.configure({ mode: "serial" });

  test("un lien magique demandé par appel direct ne contient ni lien ni code", async () => {
    const email = uniqueEmail("lien-magique");
    await createConfirmedUser(email, strongPassword());

    const { error } = await directClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    expect(error).toBeNull();

    expectInert(await waitForEmailHtml(email, "Demande sans effet"));
  });

  test("une réauthentification demandée par appel direct n'envoie aucun code", async () => {
    const email = uniqueEmail("reauthentification");
    const password = strongPassword();
    await createConfirmedUser(email, password);

    const client = directClient();
    const session = await client.auth.signInWithPassword({ email, password });
    expect(session.error).toBeNull();
    const { error } = await client.auth.reauthenticate();
    expect(error).toBeNull();

    expectInert(await waitForEmailHtml(email, "Demande sans effet"));
  });

  test("une invitation ne contient ni lien ni code", async () => {
    const email = uniqueEmail("invitation");

    const { error } = await directClient("SUPABASE_SECRET_KEY").auth.admin.inviteUserByEmail(email);
    expect(error).toBeNull();

    expectInert(await waitForEmailHtml(email, "Demande sans effet"));
  });

  test("un changement d'adresse demandé par appel direct ne se confirme pas", async () => {
    const email = uniqueEmail("changement-adresse");
    const password = strongPassword();
    const newEmail = uniqueEmail("nouvelle-adresse");
    await createConfirmedUser(email, password);

    const client = directClient();
    const session = await client.auth.signInWithPassword({ email, password });
    expect(session.error).toBeNull();
    const change = await client.auth.updateUser({ email: newEmail });
    expect(change.error).toBeNull();
    // Le service écrit aux deux adresses : aucun des deux messages ne permet de confirmer.
    expectInert(await waitForEmailHtml(newEmail, "Demande sans effet"));
    expectInert(await waitForEmailHtml(email, "Demande sans effet"));
    const after = await client.auth.getUser();
    expect(after.data.user?.email).toBe(email);
  });
});
