import {notFound} from 'next/navigation';
import OperatorPasskey from '@/components/operator-passkey';

export const metadata = {title:{absolute:'패스키 | NURI ONE'}};

export default function PasskeyPage() {
 if (process.env.NEXT_PUBLIC_ONE_PASSKEYS_ENABLED !== 'true') notFound();
 return <OperatorPasskey/>;
}
