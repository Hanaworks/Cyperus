//! Deterministic labels over a bounded prefix, strict validation over the bytes
//! actually returned. Never transcode the IPC payload or substitute U+FFFD.
use crate::error::AppError;
use encoding_rs::{DecoderResult, Encoding, GB18030, UTF_16BE, UTF_16LE, UTF_8};

pub const SAMPLE_BYTES: usize = 64 * 1024;

pub struct Detected {
    pub label: String,
    pub had_bom: bool,
}

pub fn detect(bytes: &[u8], complete: bool) -> Result<Detected, AppError> {
    let sample = &bytes[..bytes.len().min(SAMPLE_BYTES)];
    let last = complete && sample.len() == bytes.len();
    let (encoding, had_bom) = if sample.starts_with(&[0xef, 0xbb, 0xbf]) {
        (UTF_8, true)
    } else if sample.starts_with(&[0xff, 0xfe]) {
        (UTF_16LE, true)
    } else if sample.starts_with(&[0xfe, 0xff]) {
        (UTF_16BE, true)
    } else if std::str::from_utf8(sample).is_ok()
        || (!last && std::str::from_utf8(sample).is_err_and(|e| e.error_len().is_none()))
    {
        (UTF_8, false)
    } else {
        let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
        detector.feed(sample, last);
        let guessed = detector.guess(Some(b"cn"), chardetng::Utf8Detection::Allow);
        // GBK is a subset of GB18030; the latter also supports four-byte codepoints.
        (
            if guessed == encoding_rs::GBK {
                GB18030
            } else {
                guessed
            },
            false,
        )
    };
    validate(encoding, bytes, complete)?;
    Ok(Detected {
        label: encoding.name().to_ascii_lowercase(),
        had_bom,
    })
}

fn validate(encoding: &'static Encoding, bytes: &[u8], complete: bool) -> Result<(), AppError> {
    let controls = |text: &[u8]| {
        text.iter()
            .any(|b| *b < 32 && !matches!(*b, b'\t' | b'\n' | b'\r'))
    };
    if encoding == UTF_8 {
        if controls(bytes) {
            return Err(AppError::Encoding);
        }
        return match std::str::from_utf8(bytes) {
            Ok(_) => Ok(()),
            Err(e) if !complete && e.error_len().is_none() => Ok(()),
            Err(_) => Err(AppError::Encoding),
        };
    }
    let mut decoder = encoding.new_decoder_with_bom_removal();
    let mut output = [0; 8192];
    let mut offset = 0;
    loop {
        let (result, read, written) =
            decoder.decode_to_utf8_without_replacement(&bytes[offset..], &mut output, complete);
        offset += read;
        if controls(&output[..written]) {
            return Err(AppError::Encoding);
        }
        match result {
            DecoderResult::InputEmpty => return Ok(()),
            DecoderResult::Malformed(..) => return Err(AppError::Encoding),
            DecoderResult::OutputFull => (),
        }
    }
}
