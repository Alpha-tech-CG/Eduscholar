import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  makeAdmin,
  signInThroughForm,
  sql,
  strongPassword,
  TEST_FACTOR_SECRET,
  uniqueEmail,
} from "./support/auth";
import { freshTotp } from "./support/totp";

// Petit écran (cahier §10.7, ADR-0012) : à 360 points de large, la page ne
// défile pas horizontalement, les actions principales offrent une cible d'au
// moins 44 points, et un tableau défile dans son propre conteneur.

const WIDTH = 360;
const MIN_TARGET = 44;

type Audit = { overflow: number; wide: string[]; small: string[]; tables: string[] };

async function audit(page: Page): Promise<Audit> {
  return page.evaluate(({ minTarget, viewport }) => {
    const describe = (element: Element) => {
      const box = element.getBoundingClientRect();
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const name = element.getAttribute("name") ?? element.getAttribute("aria-label") ?? "";
      return `${element.tagName.toLowerCase()}[${name}] « ${text} » ${Math.round(box.width)}x${Math.round(box.height)}`;
    };
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 1 && box.height > 1 && style.visibility !== "hidden" && style.display !== "none";
    };
    /** L'élément défile-t-il dans un conteneur qui lui est propre ? */
    const scrolls = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX)) return true;
      }
      return false;
    };

    const wide = [...document.querySelectorAll("body *")]
      .filter((element) => visible(element) && !scrolls(element))
      .filter((element) => element.getBoundingClientRect().right > viewport + 1)
      .map(describe);
    // Actions principales : boutons, champs de saisie et liens du menu.
    const small = [
      ...document.querySelectorAll(
        'button, select, textarea, summary, header nav a, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
      ),
    ]
      .filter(visible)
      .filter((element) => element.getBoundingClientRect().height < minTarget - 0.5)
      .map(describe);
    const tables = [...document.querySelectorAll("table")]
      .filter((table) => !scrolls(table))
      .map(describe);

    return {
      // Mesuré contre la largeur voulue : sur mobile, la fenêtre s'élargit avec le contenu.
      overflow: Math.max(0, document.documentElement.scrollWidth - viewport),
      wide: wide.slice(0, 8),
      small,
      tables,
    };
  }, { minTarget: MIN_TARGET, viewport: WIDTH });
}

/** Parcourt les écrans et rend, par adresse, ce qui ne convient pas à un petit écran. */
async function findings(page: Page, paths: string[]) {
  const found: Record<string, Partial<Audit>> = {};
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
    const { overflow, wide, small, tables } = await audit(page);
    if (overflow > 0 || wide.length + small.length + tables.length > 0) {
      found[path] = { overflow, wide, small, tables };
    }
  }
  return found;
}

/** Des contenus longs et sans espace : ce qui déborde d'ordinaire sur un petit écran. */
function seed(ownerId: string) {
  const token = `petit${Date.now()}${Math.round(Math.random() * 1e6)}`;
  const long = `Supercalifragilisticexpialidocious${"anticonstitutionnellement".repeat(3)}`;
  const ids = {
    token,
    resource: randomUUID(),
    project: randomUUID(),
    section: randomUUID(),
    source: randomUUID(),
  };
  sql(`
    insert into public.resources
      (id, type_code, title, authors, publication_year, language_code, program_code, source_kind, source_name,
       level_codes, subject_codes, tags, official_url, access_status, license_code,
       editorial_status, last_verified_at, published_at)
    values
      ('${ids.resource}', 'article', '${long} ${token}', array['Awa Diop', 'Kofi Mensah'], 2023,
       'fr', 'computer_science', 'connector', 'e2e-seed', array['bachelor_3'], array['algorithms'], array['réseaux'],
       'https://exemple.invalid/${token}/${long}/${long}', 'open_access', 'cc-by-4.0', 'published', now(), now());
    insert into public.research_projects (id, owner_id, title) values ('${ids.project}', '${ownerId}', 'Mémoire ${long}');
    insert into public.thesis_sections (id, project_id, position, level, title, body)
      values ('${ids.section}', '${ids.project}', 1, 1, 'Introduction ${long}', 'Texte ${long}');
    insert into public.project_sources (id, project_id, source_type, title, authors, publication_year) values
      ('${ids.source}', '${ids.project}', 'article', 'Source ${long}', array['Diop, Awa'], 2021)
  `);
  return ids;
}

test.describe("petit écran", () => {
  // Une adresse de client propre à ce fichier : ses connexions ne pèsent pas sur
  // la limite par adresse que se partagent les autres parcours.
  test.use({
    viewport: { width: WIDTH, height: 740 },
    extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.22" },
  });
  test.setTimeout(120_000);

  test("les écrans publics tiennent dans 360 points", async ({ page }) => {
    const paths = ["/fr", "/en", "/fr/sign-in", "/fr/sign-up", "/fr/forgot-password", "/fr/adresse-inconnue"];
    expect(await findings(page, paths)).toEqual({});
  });

  test("les écrans du compte, de la recherche et du projet tiennent dans 360 points", async ({ page }) => {
    const email = uniqueEmail("petit");
    const password = strongPassword();
    const id = await createConfirmedUser(email, password);
    completeProfileDirectly(id);
    const ids = seed(id);
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/account/);

    const project = `/fr/projects/${ids.project}`;
    const paths = [
      "/fr/account",
      `/fr/search?q=${ids.token}`,
      `/fr/resources/${ids.resource}`,
      "/fr/library",
      "/fr/projects",
      project,
      `${project}/outline`,
      `${project}/outline/${ids.section}`,
      `${project}/sources`,
      `${project}/sources/${ids.source}`,
      `${project}/matrix`,
      `${project}/tasks`,
      `${project}/versions`,
      `${project}/bibliography`,
      `${project}/document`,
      `${project}/sharing`,
      "/fr/notifications",
    ];
    expect(await findings(page, paths)).toEqual({});
  });

  test("l'administration tient dans 360 points", async ({ page }) => {
    const email = uniqueEmail("petit-admin");
    const password = strongPassword();
    const id = await createConfirmedUser(email, password);
    completeProfileDirectly(id);
    makeAdmin(id, "platform_admin");
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
    await page.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, new Set()));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/fr\/account/);

    // Une organisation au nom long, que ce compte administre : ses écrans aussi.
    const organizationId = randomUUID();
    const long = `Organisation ${"anticonstitutionnellement".repeat(4)}`;
    // L'identifiant commence par un compteur décroissant : la liste, triée par
    // identifiant, montre cette organisation sur sa première page.
    const slug = `0${9_999_999_999_999 - Date.now()}-petit-${organizationId.slice(0, 8)}`;
    sql(`
      insert into public.organizations (id, slug, name, status)
        values ('${organizationId}', '${slug}', '${long}', 'verified');
      insert into public.organization_members (organization_id, user_id, role)
        values ('${organizationId}', '${id}', 'org_admin')
    `);
    try {
      expect(
        await findings(page, [
          "/fr/admin",
          "/fr/moderation",
          "/fr/admin/organizations",
          "/fr/admin/references",
          "/fr/admin/references?kind=education_levels",
          "/fr/admin/references?kind=subjects&q=informatique",
          "/fr/admin/references?kind=licenses",
          "/fr/organizations",
          `/fr/organizations/${organizationId}`,
        ]),
      ).toEqual({});
    } finally {
      // L'organisation ne reste pas dans la base locale.
      try {
        sql(`
          update public.organizations set status = 'suspended' where id = '${organizationId}';
          select set_config('eduscholar.organization_dissolution', '${organizationId}', true);
          delete from public.organization_members where organization_id = '${organizationId}';
          delete from public.organizations where id = '${organizationId}'
        `);
      } catch {
        // Le ménage est un confort.
      }
    }
  });
});
