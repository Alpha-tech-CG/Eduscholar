"use client";

import { useEffect, useRef } from "react";
import { CAPTCHA_FIELD } from "@/lib/auth/captcha-shared";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Turnstile = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "response-field": boolean;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

function turnstile(): Turnstile | undefined {
  return (window as unknown as { turnstile?: Turnstile }).turnstile;
}

/** Charge le script une seule fois pour la page. */
let loading: Promise<void> | undefined;
function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    if (turnstile()) return resolve();
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = undefined;
      reject(new Error("captcha"));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * Widget Cloudflare Turnstile. Le jeton obtenu est placé dans un champ caché
 * du formulaire ; il ne sert qu'une fois, le widget est donc relancé après
 * chaque envoi.
 */
export function CaptchaWidget({ siteKey, label }: { siteKey: string; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    const setToken = (token: string) => {
      if (field.current) field.current.value = token;
    };

    loadScript()
      .then(() => {
        const api = turnstile();
        if (cancelled || !api || !container.current) return;
        id = api.render(container.current, {
          sitekey: siteKey,
          callback: setToken,
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
          "response-field": false,
        });
      })
      .catch(() => {
        // Script injoignable : le formulaire part sans jeton, et le service
        // d'authentification refuse. Rien n'est contourné.
      });

    const form = field.current?.form;
    const onSubmit = () => {
      // Le jeton part avec cet envoi ; un nouveau défi est préparé pour le suivant.
      window.setTimeout(() => {
        if (id !== undefined) turnstile()?.reset(id);
        setToken("");
      }, 3000);
    };
    form?.addEventListener("submit", onSubmit);

    return () => {
      cancelled = true;
      form?.removeEventListener("submit", onSubmit);
      if (id !== undefined) turnstile()?.remove(id);
    };
  }, [siteKey]);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm opacity-80">{label}</p>
      <div ref={container} data-testid="captcha" />
      <input ref={field} type="hidden" name={CAPTCHA_FIELD} defaultValue="" />
    </div>
  );
}
