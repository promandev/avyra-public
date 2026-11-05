'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, BellOff, Loader2 } from 'lucide-react';

interface Props {
  vapidPublicKey: string;
  showDiagnostics?: boolean;
}

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export function PushSubscriptionToggle({ vapidPublicKey, showDiagnostics = false }: Props) {
  const t = useTranslations('account');
  const [permission, setPermission] = useState<PermissionState>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [diagLogs, setDiagLogs] = useState<string[]>([]);
  const [blockedByAdmin, setBlockedByAdmin] = useState(false);

  function logStep(message: string) {
    const stamp = new Date().toLocaleTimeString();
    setDiagLogs((prev) => [`${stamp} - ${message}`, ...prev].slice(0, 12));
  }

  useEffect(() => {
    logStep('Iniciando comprobacion de push...');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPermission('unsupported');
      setLoading(false);
      logStep('Push no soportado por este navegador/dispositivo');
      return;
    }

    setPermission(Notification.permission as PermissionState);
    logStep(`Permiso actual: ${Notification.permission}`);

    // Registrar el SW y comprobar si ya hay suscripción activa.
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        logStep('Service Worker registrado correctamente');
        return reg.pushManager.getSubscription();
      })
      .then((sub) => {
        setSubscribed(sub !== null);
        logStep(sub ? 'Suscripcion existente detectada' : 'No hay suscripcion en este dispositivo');
      })
      .catch((err) => {
        console.error(err);
        logStep(`Error registrando Service Worker: ${formatError(err)}`);
      })
      .finally(() => {
        setLoading(false);
        logStep('Comprobacion inicial completada');
      });
  }, []);

  async function subscribe() {
    setLoading(true);
    logStep('Iniciando alta de notificaciones...');
    try {
      const reg = await navigator.serviceWorker.ready;
      logStep('Service Worker listo');

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      logStep('Suscripcion generada en el navegador');

      const json = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });

      if (!res.ok) {
        const body = await safeReadJson(res);
        if (res.status === 403) {
          setBlockedByAdmin(true);
          await sub.unsubscribe();
          logStep('El administrador ha desactivado las notificaciones para esta cuenta');
          return;
        }
        throw new Error(`API /api/push/subscribe fallo (${res.status}): ${body}`);
      }
      logStep('Suscripcion guardada en servidor');

      setBlockedByAdmin(false);
      setSubscribed(true);
      setPermission('granted');
      logStep('Notificaciones activadas con exito');
    } catch (err) {
      console.error('[push] subscribe error', err);
      setPermission(Notification.permission as PermissionState);
      logStep(`Error al activar notificaciones: ${formatError(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    logStep('Iniciando baja de notificaciones...');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const res = await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (!res.ok) {
          const body = await safeReadJson(res);
          throw new Error(`API /api/push/subscribe DELETE fallo (${res.status}): ${body}`);
        }
        await sub.unsubscribe();
        logStep('Suscripcion eliminada del servidor y navegador');
      } else {
        logStep('No habia suscripcion activa para eliminar');
      }
      setSubscribed(false);
      logStep('Notificaciones desactivadas');
    } catch (err) {
      console.error('[push] unsubscribe error', err);
      logStep(`Error al desactivar notificaciones: ${formatError(err)}`);
    } finally {
      setLoading(false);
    }
  }

  if (permission === 'unsupported') {
    return (
      <p className="text-sm text-foreground/70">
        {t('pushUnsupported')}
      </p>
    );
  }

  if (permission === 'denied') {
    return (
      <p className="text-sm text-foreground/70">
        {t('pushBlocked')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {blockedByAdmin && (
        <p className="text-sm text-destructive">{t('pushBlockedByAdmin')}</p>
      )}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            {subscribed ? t('pushActive') : t('pushInactive')}
          </p>
          <p className="text-xs text-foreground/70">
            {subscribed ? t('pushActiveDesc') : t('pushInactiveDesc')}
          </p>
        </div>
        <button
          onClick={subscribed ? unsubscribe : subscribe}
          disabled={loading}
          className="flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-muted disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : subscribed ? (
            <BellOff className="size-4" />
          ) : (
            <Bell className="size-4" />
          )}
          {subscribed ? t('pushDisable') : t('pushEnable')}
        </button>
      </div>

      {showDiagnostics && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/70">
              {t('pushDiagTitle')}
            </p>
            <p className="text-xs text-foreground/70">{t('pushDiagPermission', { permission })}</p>
          </div>
          {diagLogs.length === 0 ? (
            <p className="text-xs text-foreground/70">{t('pushDiagEmpty')}</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-auto pr-1">
              {diagLogs.map((line, idx) => (
                <p key={`${idx}-${line}`} className="text-xs text-foreground/85">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function safeReadJson(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as unknown;
    return JSON.stringify(data);
  } catch {
    return 'respuesta no JSON';
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Convierte la clave VAPID de base64url a Uint8Array para la API de PushManager.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0))) as Uint8Array<ArrayBuffer>;
}
