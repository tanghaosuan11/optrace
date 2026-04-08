use revm::primitives::hardfork::SpecId;

#[derive(Clone, Copy)]
struct ChainForkSchedule {
    chain_id: u64,
    name: &'static str,
    activations: &'static [(u64, SpecId)],
}

// Ethereum Mainnet activation heights.
const ETH_MAINNET_ACTIVATIONS: &[(u64, SpecId)] = &[
    (0, SpecId::FRONTIER),
    (1_150_000, SpecId::HOMESTEAD),
    (2_463_000, SpecId::TANGERINE),
    (2_675_000, SpecId::SPURIOUS_DRAGON),
    (4_370_000, SpecId::BYZANTIUM),
    // Constantinople/Petersburg share activation height on mainnet.
    (7_280_000, SpecId::PETERSBURG),
    (9_069_000, SpecId::ISTANBUL),
    (9_200_000, SpecId::MUIR_GLACIER),
    (12_244_000, SpecId::BERLIN),
    (12_965_000, SpecId::LONDON),
    (13_773_000, SpecId::ARROW_GLACIER),
    (15_050_000, SpecId::GRAY_GLACIER),
    (15_537_394, SpecId::MERGE),
    (17_034_870, SpecId::SHANGHAI),
    (19_426_587, SpecId::CANCUN),
];

// Non-mainnet schedules are chain-scoped and can be expanded incrementally.
// For now we keep a conservative floor (CANCUN) for known EVM chains frequently used in this project.
const BSC_ACTIVATIONS: &[(u64, SpecId)] = &[(0, SpecId::CANCUN)];
const BASE_ACTIVATIONS: &[(u64, SpecId)] = &[(0, SpecId::CANCUN)];
const OP_ACTIVATIONS: &[(u64, SpecId)] = &[(0, SpecId::CANCUN)];
const ARBITRUM_ONE_ACTIVATIONS: &[(u64, SpecId)] = &[(0, SpecId::CANCUN)];
const POLYGON_ACTIVATIONS: &[(u64, SpecId)] = &[(0, SpecId::CANCUN)];

const SCHEDULES: &[ChainForkSchedule] = &[
    ChainForkSchedule {
        chain_id: 1,
        name: "Ethereum Mainnet",
        activations: ETH_MAINNET_ACTIVATIONS,
    },
    ChainForkSchedule {
        chain_id: 56,
        name: "BSC",
        activations: BSC_ACTIVATIONS,
    },
    ChainForkSchedule {
        chain_id: 8453,
        name: "Base",
        activations: BASE_ACTIVATIONS,
    },
    ChainForkSchedule {
        chain_id: 10,
        name: "OP Mainnet",
        activations: OP_ACTIVATIONS,
    },
    ChainForkSchedule {
        chain_id: 42161,
        name: "Arbitrum One",
        activations: ARBITRUM_ONE_ACTIVATIONS,
    },
    ChainForkSchedule {
        chain_id: 137,
        name: "Polygon PoS",
        activations: POLYGON_ACTIVATIONS,
    },
];

fn pick_from_activations(block_number: u64, activations: &[(u64, SpecId)]) -> SpecId {
    let mut picked = activations.first().map(|(_, s)| *s).unwrap_or(SpecId::CANCUN);
    for (at, spec) in activations {
        if block_number >= *at {
            picked = *spec;
        } else {
            break;
        }
    }
    picked
}

pub(crate) fn spec_id_for_chain_block(chain_id: u64, block_number: u64) -> SpecId {
    if let Some(schedule) = SCHEDULES.iter().find(|s| s.chain_id == chain_id) {
        let spec = pick_from_activations(block_number, schedule.activations);
        println!(
            "[env] fork schedule: chain={}({}) block={} -> {:?}",
            schedule.chain_id, schedule.name, block_number, spec
        );
        return spec;
    }

    let fallback = SpecId::CANCUN;
    eprintln!(
        "[env][warn] no fork schedule for chain_id={} at block={}; fallback to {:?}",
        chain_id, block_number, fallback
    );
    fallback
}

pub(crate) fn parse_spec_id_name(name: &str) -> Option<SpecId> {
    let s = name.trim().to_ascii_lowercase();
    match s.as_str() {
        "frontier" => Some(SpecId::FRONTIER),
        "homestead" => Some(SpecId::HOMESTEAD),
        "tangerine" | "tangerine_whistle" => Some(SpecId::TANGERINE),
        "spurious" | "spurious_dragon" => Some(SpecId::SPURIOUS_DRAGON),
        "byzantium" => Some(SpecId::BYZANTIUM),
        "constantinople" | "petersburg" => Some(SpecId::PETERSBURG),
        "istanbul" => Some(SpecId::ISTANBUL),
        "muir_glacier" => Some(SpecId::MUIR_GLACIER),
        "berlin" => Some(SpecId::BERLIN),
        "london" => Some(SpecId::LONDON),
        "arrow_glacier" => Some(SpecId::ARROW_GLACIER),
        "gray_glacier" => Some(SpecId::GRAY_GLACIER),
        "merge" | "paris" => Some(SpecId::MERGE),
        "shanghai" => Some(SpecId::SHANGHAI),
        "cancun" => Some(SpecId::CANCUN),
        _ => None,
    }
}
