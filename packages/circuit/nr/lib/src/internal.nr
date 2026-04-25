// Vendored helpers - replaces our previous nodash dep so the lib stays
// compatible with aztec-nr's pinned poseidon (v0.2.3) when reused inside
// an Aztec contract. Recipes match nodash v0.45.0 exactly so existing
// commitments and the TS encode_outputs mirror still line up.

use poseidon::poseidon2::Poseidon2;

// Identical to nodash::array::field_from_bytes: little-endian byte->Field
// for chunks shorter than 32 bytes.
fn field_from_bytes<let N: u32>(bytes: [u8; N]) -> Field {
    assert(bytes.len() < 32, "field_from_bytes: N must be less than 32");
    let mut as_field: Field = 0;
    let mut offset: Field = 1;
    for i in 0..N {
        as_field += (bytes[i] as Field) * offset;
        offset *= 256;
    }
    as_field
}

// Identical to nodash::pack_bytes::<N>(bytes):
//   - pad-end the input to (N/31 + 1) * 31 bytes (zeros)
//   - pack each 31-byte chunk into one Field, little-endian within the chunk
pub fn pack_bytes<let N: u32>(bytes: [u8; N]) -> [Field; N / 31 + 1] {
    let chunks: u32 = N / 31 + 1;
    // Pad-end to chunks * 31 with zeros. The fixed array length must be
    // expressed in terms of N (not a runtime `padded_len`).
    let mut padded: [u8; (N / 31 + 1) * 31] = [0; (N / 31 + 1) * 31];
    for i in 0..N {
        padded[i] = bytes[i];
    }

    let mut out: [Field; N / 31 + 1] = [0; N / 31 + 1];
    for c in 0..chunks {
        let mut chunk: [u8; 31] = [0; 31];
        for j in 0..31 {
            chunk[j] = padded[c * 31 + j];
        }
        out[c] = field_from_bytes(chunk);
    }
    out
}

// Same shape as nodash::poseidon2 for fixed-size Field arrays.
pub fn poseidon2<let N: u32>(input: [Field; N]) -> Field {
    Poseidon2::hash(input, N)
}
