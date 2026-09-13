//! The one binary input shape: a list of named byte strings, for ops that take
//! whole files. JSON would cost an escape pass over every byte of every log.
//!
//! `[u32 count] ( [u32 name length][name] [u32 data length][data] )*`, little
//! endian throughout.

pub struct NamedBytes<'a> {
    pub name: &'a str,
    pub data: &'a [u8],
}

pub fn decode(input: &[u8]) -> Result<Vec<NamedBytes<'_>>, String> {
    let mut cursor = 0usize;

    let take_u32 = |cursor: &mut usize| -> Result<usize, String> {
        let end = *cursor + 4;
        let bytes: [u8; 4] = input
            .get(*cursor..end)
            .ok_or("frame: truncated length")?
            .try_into()
            .expect("four bytes");
        *cursor = end;
        Ok(u32::from_le_bytes(bytes) as usize)
    };

    let count = take_u32(&mut cursor)?;
    let mut items = Vec::with_capacity(count);

    for _ in 0..count {
        let name_len = take_u32(&mut cursor)?;
        let name = input
            .get(cursor..cursor + name_len)
            .ok_or("frame: truncated name")?;
        cursor += name_len;

        let data_len = take_u32(&mut cursor)?;
        let data = input
            .get(cursor..cursor + data_len)
            .ok_or("frame: truncated data")?;
        cursor += data_len;

        items.push(NamedBytes {
            name: std::str::from_utf8(name).map_err(|e| format!("frame: name: {e}"))?,
            data,
        });
    }

    if cursor != input.len() {
        return Err("frame: trailing bytes".into());
    }

    Ok(items)
}

#[cfg(test)]
pub fn encode(items: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend((items.len() as u32).to_le_bytes());

    for (name, data) in items {
        out.extend((name.len() as u32).to_le_bytes());
        out.extend(name.as_bytes());
        out.extend((data.len() as u32).to_le_bytes());
        out.extend(*data);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let framed = encode(&[("a.jsonl", b"one\n"), ("b.jsonl", b"")]);
        let items = decode(&framed).unwrap();

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "a.jsonl");
        assert_eq!(items[0].data, b"one\n");
        assert_eq!(items[1].data, b"");
    }

    #[test]
    fn refuses_a_short_frame() {
        assert!(decode(&[1, 0, 0, 0, 5, 0]).is_err());
        assert!(decode(&[0, 0, 0, 0, 9]).is_err());
    }
}
