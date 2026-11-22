import { cn } from "cn";
import { Loader2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";

type SpinnerProps = {
  className?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
};

function Spinner({ className, ...props }: SpinnerProps) {
  const { t } = useTranslation();
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={t("common.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
