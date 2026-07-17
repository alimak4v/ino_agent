use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const VECTOR_DIM: usize = 384;

pub fn tokenize(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in value.to_lowercase().replace('ё', "е").chars() {
        if ch.is_alphanumeric() {
            current.push(ch);
        } else if !current.is_empty() {
            if current.chars().count() >= 2 {
                tokens.push(current.clone());
            }
            current.clear();
        }
    }
    if current.chars().count() >= 2 {
        tokens.push(current);
    }
    tokens
}

pub fn embed_text(value: &str) -> Vec<f32> {
    let mut vector = vec![0.0_f32; VECTOR_DIM];
    let tokens = tokenize(value);
    for token in &tokens {
        add_hashed_feature(&mut vector, token, 1.0);
        let chars = token.chars().collect::<Vec<_>>();
        for window in chars.windows(3) {
            let trigram = window.iter().collect::<String>();
            add_hashed_feature(&mut vector, &trigram, 0.35);
        }
    }
    let norm = vector
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .sum::<f64>()
        .sqrt();
    if norm > 0.0 {
        for value in &mut vector {
            *value /= norm as f32;
        }
    }
    vector
}

pub fn encode(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

pub fn decode(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let dot = a
        .iter()
        .zip(b.iter())
        .map(|(x, y)| (*x as f64) * (*y as f64))
        .sum::<f64>();
    dot.clamp(0.0, 1.0)
}

fn add_hashed_feature(vector: &mut [f32], feature: &str, weight: f32) {
    let mut hasher = DefaultHasher::new();
    feature.hash(&mut hasher);
    let hash = hasher.finish();
    let index = (hash as usize) % vector.len();
    let sign: f32 = if (hash >> 63) == 0 { 1.0 } else { -1.0 };
    vector[index] += sign * weight;
}
