import { runRendererTask } from '@/lib/global-error-recovery';
import {
  ArrowUpRightIcon,
  BanknoteIcon,
  GlobeIcon,
  Globe2Icon,
  LightbulbIcon,
  MailIcon,
  MessagesSquareIcon,
  RadioIcon,
  ShieldCheckIcon,
  WalletIcon,
} from 'lucide-react';
import { Check as CheckShape, Copy as CopyShape } from 'lucide';
import { useNavigate } from '@tanstack/react-router';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EVoiceMark } from '@/components/brand/evoice-mark';
import { ReportBug } from '@/components/report-bug';
import { ExternalLink } from '@/components/external-link';
import { Button } from '@/components/ui/button';
import { MorphIcon } from '@/components/ui/morph-icon';
import { vietQrPayload } from '@/lib/vietqr';
import { DONATE, EVOICE_LINKS, isSet } from './evoice-support';
import './support-settings.css';

function CopyValue({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="support-pay-row">
      <dt>{label}</dt>
      <dd>
        <span className="tabular-nums">{value}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('supportEvoice.copy', { label })}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <MorphIcon icon={copied ? CheckShape : CopyShape} />
        </Button>
      </dd>
    </div>
  );
}

function useQrImage(payload: string) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(payload, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [payload]);
  return src;
}

export function SupportSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [momoQr, setMomoQr] = useState(true);
  const bankQr = useQrImage(
    vietQrPayload({ bin: DONATE.bank.bin, account: DONATE.bank.account, note: DONATE.bank.note }),
  );
  const channels = (
    [
      ['contact.feature_cta', EVOICE_LINKS.feature, LightbulbIcon],
      ['contact.community_cta', EVOICE_LINKS.community, MessagesSquareIcon],
      ['contact.follow_cta', EVOICE_LINKS.follow, RadioIcon],
      ['contact.security_cta', EVOICE_LINKS.security, ShieldCheckIcon],
      ['contact.email', EVOICE_LINKS.email, MailIcon],
      ['contact.website', EVOICE_LINKS.website, Globe2Icon],
    ] as const
  ).filter(([, href]) => isSet(href));

  return (
    <div className="support-studio">
      <header className="support-intro">
        <div className="support-emblem" aria-hidden="true">
          <EVoiceMark size={100} />
        </div>
        <h1>{t('supportEvoice.hero_title')}</h1>
        <p>{t('supportEvoice.hero_body')}</p>
      </header>

      <section className="support-donate" aria-label={t('supportEvoice.hero_title')}>
        <article className="support-pay-card">
          <h2>
            <WalletIcon aria-hidden="true" />
            {t('supportEvoice.momo_title')}
          </h2>
          {momoQr && (
            <img
              className="support-pay-qr"
              src={DONATE.momo.qr}
              alt={t('supportEvoice.qr_alt', { method: 'Momo' })}
              onError={() => setMomoQr(false)}
            />
          )}
          <dl>
            <CopyValue label={t('supportEvoice.phone')} value={DONATE.momo.phone} />
            <CopyValue label={t('supportEvoice.holder')} value={DONATE.momo.holder} />
          </dl>
        </article>
        <article className="support-pay-card">
          <h2>
            <BanknoteIcon aria-hidden="true" />
            {t('supportEvoice.bank_title', { bank: DONATE.bank.bank })}
          </h2>
          {bankQr && (
            <img
              className="support-pay-qr"
              src={bankQr}
              alt={t('supportEvoice.qr_alt', { method: DONATE.bank.bank })}
            />
          )}
          <dl>
            <CopyValue label={t('supportEvoice.account')} value={DONATE.bank.account} />
            <CopyValue label={t('supportEvoice.holder')} value={DONATE.bank.holder} />
          </dl>
        </article>
        <article className="support-pay-card support-paypal">
          <h2>
            <GlobeIcon aria-hidden="true" />
            {t('supportEvoice.paypal_title')}
          </h2>
          <p>{t('supportEvoice.paypal_body')}</p>
          <div
            className="support-paypal-amounts"
            role="group"
            aria-label={t('supportEvoice.paypal_title')}
          >
            {DONATE.paypal.amounts.map((amount) => (
              <ExternalLink
                key={amount}
                href={`${DONATE.paypal.url}/${amount}USD`}
                showIcon={false}
              >
                ${amount}
              </ExternalLink>
            ))}
            <ExternalLink href={DONATE.paypal.url}>{t('supportEvoice.paypal_any')}</ExternalLink>
          </div>
        </article>
        <p className="support-pay-note">{t('supportEvoice.scan_hint')}</p>
      </section>

      <div className="support-opportunities">
        <section className="support-tile support-license" aria-labelledby="support-pro-heading">
          <span className="mb-4 w-fit rounded-lg bg-muted px-2 py-1 text-xs font-semibold tracking-wider text-foreground">
            {t('supportPlans.pro')}
          </span>
          <h2 id="support-pro-heading">{t('proPage.title')}</h2>
          <p>{t('proPage.hero_body')}</p>
          <p>{t('proPage.billing_note')}</p>
          <button
            type="button"
            onClick={() => runRendererTask('Open Pro', () => navigate({ to: '/pro' }))}
            className="mt-4 flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t('supportPlans.get_pro')}
            <ArrowUpRightIcon aria-hidden="true" className="size-3" />
          </button>
        </section>
      </div>

      <section className="support-contact" aria-labelledby="support-contact-heading">
        <div className="support-contact-heading">
          <h2 id="support-contact-heading">{t('contact.channels_label')}</h2>
          <ReportBug />
        </div>
        <div className="support-channel-grid">
          {channels.map(([label, href, Icon]) => (
            <ExternalLink key={href} href={href}>
              <Icon aria-hidden="true" />
              <span>{t(label)}</span>
            </ExternalLink>
          ))}
        </div>
      </section>
    </div>
  );
}
