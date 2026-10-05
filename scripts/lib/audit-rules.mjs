// Évaluation d'un rapport `npm audit --json` face à une liste d'exceptions.

const blockingSeverities = new Set(["high", "critical"]);

function advisoryId(url) {
  return /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(url ?? "")?.[0];
}

/**
 * @param report rapport JSON de npm audit
 * @param exceptions liste `{ id, reason, expires }`
 * @param today date de référence
 */
export function evaluateAudit(report, exceptions, today) {
  // Un même avis apparaît sous chaque paquet qui en dépend : on regroupe par avis.
  const advisories = new Map();

  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object") continue;
      if (!blockingSeverities.has(via.severity)) continue;
      const id = advisoryId(via.url) ?? `${via.name}:${via.source}`;
      const advisory = advisories.get(id) ?? {
        id,
        severity: via.severity,
        title: via.title,
        packages: new Set(),
      };
      advisory.packages.add(via.name ?? name);
      advisories.set(id, advisory);
    }
  }

  const byId = new Map(exceptions.map((exception) => [exception.id, exception]));
  const blocking = [];
  const accepted = [];
  const expired = [];

  for (const advisory of advisories.values()) {
    const result = { ...advisory, packages: [...advisory.packages].sort() };
    const exception = byId.get(advisory.id);

    if (!exception) {
      blocking.push(result);
    } else if (new Date(`${exception.expires}T23:59:59Z`) < today) {
      expired.push({ id: advisory.id, expires: exception.expires });
    } else {
      accepted.push(result);
    }
  }

  const unused = exceptions
    .map(({ id }) => id)
    .filter((id) => !advisories.has(id));

  return { blocking, accepted, expired, unused };
}
