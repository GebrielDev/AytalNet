import { useEffect, useState } from 'react';
import api from '../services/api';

/**
 * A trip photo. Photos in Emergent storage are only served to a signed-in
 * dashboard user, and a plain <img> cannot send the bearer token, so those are
 * fetched through the API client (which attaches and refreshes it) and shown
 * from a local object URL. Any other URL - Cloudinary, data URIs, seeded
 * placeholders - is used directly, as before.
 */
const isPrivate = (url: string) => /\/api\/files\//.test(url);

export default function AuthImage({ src, alt, className, testId }: { src: string; alt: string; className?: string; testId?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(isPrivate(src) ? null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isPrivate(src)) {
      setObjectUrl(src);
      return;
    }
    let revoked = false;
    let created: string | null = null;
    api
      .get(src, { responseType: 'blob', baseURL: '' })
      .then((res) => {
        if (revoked) return;
        created = URL.createObjectURL(res.data as Blob);
        setObjectUrl(created);
      })
      .catch(() => !revoked && setFailed(true));
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  if (failed) {
    return (
      <div data-testid={testId} className={`${className ?? ''} bg-gray-100 flex items-center justify-center text-gray-400 text-sm`}>
        Photo unavailable
      </div>
    );
  }
  if (!objectUrl) {
    return <div data-testid={testId} className={`${className ?? ''} bg-gray-100 animate-pulse`} />;
  }
  return <img data-testid={testId} src={objectUrl} alt={alt} className={className} onError={() => setFailed(true)} />;
}
