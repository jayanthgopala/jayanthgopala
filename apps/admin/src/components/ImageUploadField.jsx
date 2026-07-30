import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, useToast } from './ui.jsx';
import CropDialog from './CropDialog.jsx';

/**
 * Drop-or-browse image upload backed by R2.
 *
 * Shared by the project screenshot and the profile portrait — both need the
 * same drag state, size/type guard and preview, and duplicating that once is
 * one time too many.
 */
export default function ImageUploadField({
  label = 'Image',
  hint = 'PNG, JPEG, WebP or AVIF · max 5MB',
  value,
  onChange,
  preview = 'wide', // 'wide' for screenshots, 'round' for portraits
  crop = false,     // round previews get the crop step
}) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingCrop, setPendingCrop] = useState(null);

  /** Portraits go through the crop step first; screenshots upload as-is. */
  function accept(file) {
    if (!file) return;
    if (crop) setPendingCrop(file);
    else upload(file);
  }

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    try {
      const { url } = await api.upload(file);
      onChange(url);
      toast.success('Uploaded.');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field field-full">
      <span className="label">{label}</span>

      {value ? (
        <div className="row">
          <img
            className="thumb"
            src={value}
            alt=""
            style={
              preview === 'round'
                ? { width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }
                : undefined
            }
          />
          <div className="row-main">
            <div className="row-sub mono">{value}</div>
          </div>
          <div className="row-actions">
            <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
              Replace
            </Button>
            <Button size="sm" variant="danger" onClick={() => onChange('')}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="dropzone"
          data-over={over || undefined}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            accept(e.dataTransfer.files?.[0]);
          }}
        >
          {busy ? (
            <span className="spinner" />
          ) : (
            <>
              <span>Drop an image, or click to browse</span>
              <span className="hint">{hint}</span>
            </>
          )}
        </div>
      )}

      {pendingCrop && (
        <CropDialog
          file={pendingCrop}
          onCancel={() => setPendingCrop(null)}
          onCropped={(cropped) => {
            setPendingCrop(null);
            upload(cropped);
          }}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
        hidden
        onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
