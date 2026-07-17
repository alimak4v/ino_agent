use crate::store::{
    KnowledgeSearchResult, MemoryItem, MemorySearchResult, RetrievalKnowledgeTrace,
    RetrievalMemoryTrace, RetrievalRelatedMemoryTrace, RetrievalTrace,
};

pub fn build_retrieval_context(
    memory_results: &[MemorySearchResult],
    related_memory: &[(MemoryItem, String, f64)],
    knowledge_results: &[KnowledgeSearchResult],
) -> String {
    if memory_results.is_empty() && related_memory.is_empty() && knowledge_results.is_empty() {
        return String::new();
    }

    let lines = memory_results
        .iter()
        .map(|result| {
            format!(
                "- [{}] {} - {} (target: {}; score: {:.2})",
                result.item.source_type,
                result.item.title,
                clip_chars(&result.item.description, 420),
                result.item.target,
                result.score
            )
        })
        .collect::<Vec<_>>();
    let related_lines = related_memory
        .iter()
        .map(|(item, label, weight)| {
            format!(
                "- [{}] {} - {} (target: {}; graph: {}; weight: {:.2})",
                item.source_type,
                item.title,
                clip_chars(&item.description, 360),
                item.target,
                label,
                weight
            )
        })
        .collect::<Vec<_>>();
    let graph_section = if related_lines.is_empty() {
        String::new()
    } else {
        format!(
            "\n\nNearby memory graph nodes. Use them only as supporting context when connected to the query:\n{}",
            related_lines.join("\n")
        )
    };
    let knowledge_lines = knowledge_results
        .iter()
        .map(|result| {
            format!(
                "- [{}] {} - {} (target: {}; offsets: {}-{}; score: {:.2})",
                result.source.source_type,
                result.source.title,
                clip_chars(&result.chunk.text, 520),
                result.chunk.target,
                result.chunk.start_offset,
                result.chunk.end_offset,
                result.score
            )
        })
        .collect::<Vec<_>>();
    let memory_section = if lines.is_empty() {
        String::new()
    } else {
        format!(
            "Relevant global long-term memory across all chats. Use it only when it helps. If you rely on it, mention the target path/location where useful:\n{}{}",
            lines.join("\n"),
            graph_section
        )
    };
    let knowledge_section = if knowledge_lines.is_empty() {
        String::new()
    } else {
        format!(
            "Relevant indexed knowledge chunks. Treat these as source snippets, not personal memory. Cite target path/location when useful:\n{}",
            knowledge_lines.join("\n")
        )
    };
    let mut sections = Vec::new();
    if !memory_section.is_empty() {
        sections.push(memory_section);
    }
    if !knowledge_section.is_empty() {
        sections.push(knowledge_section);
    }
    format!(
        "Global retrieval context for the next answer:\n{}",
        sections.join("\n\n")
    )
}

pub fn build_retrieval_trace(
    query: &str,
    memory_results: Vec<MemorySearchResult>,
    related_memory: Vec<(MemoryItem, String, f64)>,
    knowledge_results: Vec<KnowledgeSearchResult>,
) -> RetrievalTrace {
    RetrievalTrace {
        query: query.trim().chars().take(500).collect(),
        memory_results: memory_results
            .into_iter()
            .map(|result| RetrievalMemoryTrace {
                id: result.item.id,
                title: result.item.title,
                target: result.item.target,
                source_type: result.item.source_type,
                score: result.score,
                vector_score: result.vector_score,
                keyword_score: result.keyword_score,
            })
            .collect(),
        related_memory: related_memory
            .into_iter()
            .map(|(item, label, weight)| RetrievalRelatedMemoryTrace {
                id: item.id,
                title: item.title,
                target: item.target,
                source_type: item.source_type,
                label,
                weight,
            })
            .collect(),
        knowledge_results: knowledge_results
            .into_iter()
            .map(|result| RetrievalKnowledgeTrace {
                chunk_id: result.chunk.id,
                source_id: result.source.id,
                title: result.source.title,
                target: result.chunk.target,
                source_type: result.source.source_type,
                start_offset: result.chunk.start_offset,
                end_offset: result.chunk.end_offset,
                score: result.score,
                vector_score: result.vector_score,
                keyword_score: result.keyword_score,
            })
            .collect(),
    }
}

fn clip_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let mut clipped = value
        .chars()
        .take(limit.saturating_sub(1))
        .collect::<String>();
    clipped.push_str("...");
    clipped
}
