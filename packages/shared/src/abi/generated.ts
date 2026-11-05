//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AgentRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const agentRegistryAbi = [
  {
    type: 'constructor',
    inputs: [{ name: 'admin', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'BUYER',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DEFAULT_ADMIN_ROLE',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'HUMAN',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_ROLE',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'NONE',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'OPERATOR_ROLE',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'SELLER',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'SOCIETY',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'STORAGE',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'TRUCK',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'agent', internalType: 'address', type: 'address' }],
    name: 'canBid',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'agent', internalType: 'address', type: 'address' }],
    name: 'canList',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'role', internalType: 'bytes32', type: 'bytes32' }],
    name: 'getRoleAdmin',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'grantRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'hasRole',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'agent', internalType: 'address', type: 'address' }],
    name: 'nameOf',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'agent', internalType: 'address', type: 'address' },
      { name: 'role', internalType: 'uint8', type: 'uint8' },
      { name: 'name', internalType: 'string', type: 'string' },
    ],
    name: 'register',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'callerConfirmation', internalType: 'address', type: 'address' },
    ],
    name: 'renounceRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'revokeRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'agent', internalType: 'address', type: 'address' }],
    name: 'roleOf',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'agent', internalType: 'address', type: 'address' },
      { name: 'role', internalType: 'uint8', type: 'uint8' },
    ],
    name: 'setRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'agent',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'role', internalType: 'uint8', type: 'uint8', indexed: false },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'AgentRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'previousAdminRole',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'newAdminRole',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'RoleAdminChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RoleGranted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RoleRevoked',
  },
  { type: 'error', inputs: [], name: 'AccessControlBadConfirmation' },
  {
    type: 'error',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'neededRole', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'AccessControlUnauthorizedAccount',
  },
  {
    type: 'error',
    inputs: [{ name: 'agent', internalType: 'address', type: 'address' }],
    name: 'AlreadyRegistered',
  },
  {
    type: 'error',
    inputs: [{ name: 'role', internalType: 'uint8', type: 'uint8' }],
    name: 'InvalidRole',
  },
  {
    type: 'error',
    inputs: [{ name: 'agent', internalType: 'address', type: 'address' }],
    name: 'NotRegistered',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AgentRegistryHook
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const agentRegistryHookAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'registry_',
        internalType: 'contract IAgentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'registry',
    outputs: [
      { name: '', internalType: 'contract IAgentRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint128', type: 'uint128' },
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'validate',
    outputs: [],
    stateMutability: 'view',
  },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'NotABidder',
  },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'SenderNotOwner',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ChainTrigger
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const chainTriggerAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'settlement_', internalType: 'address', type: 'address' },
      {
        name: 'factory_',
        internalType: 'contract LotFactory',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [
      { name: '', internalType: 'contract LotFactory', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'onSettled',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'qty', internalType: 'uint256', type: 'uint256' },
      { name: 'days_', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'requestStorage',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'settlement',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'requester',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'qty', internalType: 'uint256', type: 'uint256', indexed: false },
      { name: 'days_', internalType: 'uint16', type: 'uint16', indexed: false },
    ],
    name: 'StorageNeeded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'fromMarket',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'place',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      { name: 'qty', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'readyByBlock',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'TransportNeeded',
  },
  {
    type: 'error',
    inputs: [
      { name: 'requester', internalType: 'address', type: 'address' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NotAHolder',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotSettlement',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
  { type: 'error', inputs: [], name: 'ZeroQtyOrDays' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ContinuousClearingAuction
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const continuousClearingAuctionAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_token', internalType: 'address', type: 'address' },
      { name: '_totalSupply', internalType: 'uint128', type: 'uint128' },
      {
        name: '_parameters',
        internalType: 'struct AuctionParameters',
        type: 'tuple',
        components: [
          { name: 'currency', internalType: 'address', type: 'address' },
          { name: 'tokensRecipient', internalType: 'address', type: 'address' },
          { name: 'fundsRecipient', internalType: 'address', type: 'address' },
          { name: 'startBlock', internalType: 'uint64', type: 'uint64' },
          { name: 'endBlock', internalType: 'uint64', type: 'uint64' },
          { name: 'claimBlock', internalType: 'uint64', type: 'uint64' },
          { name: 'tickSpacing', internalType: 'uint256', type: 'uint256' },
          { name: 'validationHook', internalType: 'address', type: 'address' },
          { name: 'floorPrice', internalType: 'uint256', type: 'uint256' },
          {
            name: 'requiredCurrencyRaised',
            internalType: 'uint128',
            type: 'uint128',
          },
          { name: 'auctionStepsData', internalType: 'bytes', type: 'bytes' },
        ],
      },
      {
        name: '_protocolFeeController',
        internalType: 'address',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_BID_PRICE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_BLOCK_NUMBER',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_TICK_PTR',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'bidId', internalType: 'uint256', type: 'uint256' }],
    name: 'bids',
    outputs: [
      {
        name: '',
        internalType: 'struct Bid',
        type: 'tuple',
        components: [
          { name: 'startBlock', internalType: 'uint64', type: 'uint64' },
          {
            name: 'startCumulativeMps',
            internalType: 'uint24',
            type: 'uint24',
          },
          { name: 'exitedBlock', internalType: 'uint64', type: 'uint64' },
          { name: 'maxPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'owner', internalType: 'address', type: 'address' },
          { name: 'amountQ96', internalType: 'uint256', type: 'uint256' },
          { name: 'tokensFilled', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'checkpoint',
    outputs: [
      {
        name: '',
        internalType: 'struct Checkpoint',
        type: 'tuple',
        components: [
          { name: 'clearingPrice', internalType: 'uint256', type: 'uint256' },
          {
            name: 'currencyRaisedAtClearingPriceQ96X7',
            internalType: 'ValueX7',
            type: 'uint256',
          },
          {
            name: 'cumulativeMpsPerPrice',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'cumulativeMps', internalType: 'uint24', type: 'uint24' },
          { name: 'prev', internalType: 'uint64', type: 'uint64' },
          { name: 'next', internalType: 'uint64', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'blockNumber', internalType: 'uint64', type: 'uint64' }],
    name: 'checkpoints',
    outputs: [
      {
        name: '',
        internalType: 'struct Checkpoint',
        type: 'tuple',
        components: [
          { name: 'clearingPrice', internalType: 'uint256', type: 'uint256' },
          {
            name: 'currencyRaisedAtClearingPriceQ96X7',
            internalType: 'ValueX7',
            type: 'uint256',
          },
          {
            name: 'cumulativeMpsPerPrice',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'cumulativeMps', internalType: 'uint24', type: 'uint24' },
          { name: 'prev', internalType: 'uint64', type: 'uint64' },
          { name: 'next', internalType: 'uint64', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimBlock',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_bidId', internalType: 'uint256', type: 'uint256' }],
    name: 'claimTokens',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_owner', internalType: 'address', type: 'address' },
      { name: '_bidIds', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'claimTokensBatch',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'clearingPrice',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'currency',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'currencyRaised',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'currencyRaisedQ96X7',
    outputs: [{ name: '', internalType: 'ValueX7', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'endBlock',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_bidId', internalType: 'uint256', type: 'uint256' }],
    name: 'exitBid',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_bidId', internalType: 'uint256', type: 'uint256' },
      {
        name: '_lastFullyFilledCheckpointBlock',
        internalType: 'uint64',
        type: 'uint64',
      },
      { name: '_outbidBlock', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'exitPartiallyFilledBid',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'floorPrice',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_untilTickPriceQ96', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'forceIterateOverTicks',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'fundsRecipient',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'isGraduated',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lastCheckpointedBlock',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'latestCheckpoint',
    outputs: [
      {
        name: '',
        internalType: 'struct Checkpoint',
        type: 'tuple',
        components: [
          { name: 'clearingPrice', internalType: 'uint256', type: 'uint256' },
          {
            name: 'currencyRaisedAtClearingPriceQ96X7',
            internalType: 'ValueX7',
            type: 'uint256',
          },
          {
            name: 'cumulativeMpsPerPrice',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'cumulativeMps', internalType: 'uint24', type: 'uint24' },
          { name: 'prev', internalType: 'uint64', type: 'uint64' },
          { name: 'next', internalType: 'uint64', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lbpInitializationParams',
    outputs: [
      {
        name: 'params',
        internalType: 'struct LBPInitializationParams',
        type: 'tuple',
        components: [
          { name: 'initialPriceX96', internalType: 'uint256', type: 'uint256' },
          { name: 'tokensSold', internalType: 'uint256', type: 'uint256' },
          { name: 'currencyRaised', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextActiveTickPrice',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextBidId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'onTokensReceived',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pointer',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'remainingSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'remainingSupplyQ96X7',
    outputs: [{ name: '', internalType: 'ValueX7', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_priceQ96', internalType: 'uint256', type: 'uint256' }],
    name: 'requiredDemandQ96',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requiredDemandQ96AtNextActiveTick',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'startBlock',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'step',
    outputs: [
      {
        name: '',
        internalType: 'struct AuctionStep',
        type: 'tuple',
        components: [
          { name: 'mps', internalType: 'uint24', type: 'uint24' },
          { name: 'startBlock', internalType: 'uint64', type: 'uint64' },
          { name: 'endBlock', internalType: 'uint64', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_maxPriceQ96', internalType: 'uint256', type: 'uint256' },
      { name: '_amount', internalType: 'uint128', type: 'uint128' },
      { name: '_owner', internalType: 'address', type: 'address' },
      { name: '_hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'submitBid',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_maxPriceQ96', internalType: 'uint256', type: 'uint256' },
      { name: '_amount', internalType: 'uint128', type: 'uint128' },
      { name: '_owner', internalType: 'address', type: 'address' },
      { name: '_prevTickPriceQ96', internalType: 'uint256', type: 'uint256' },
      { name: '_hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'submitBid',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'sumCurrencyDemandAboveClearingQ96',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'sweepCurrency',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'sweepCurrencyBlock',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'sweepUnsoldTokens',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'sweepUnsoldTokensBlock',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tickSpacing',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'priceQ96', internalType: 'uint256', type: 'uint256' }],
    name: 'ticks',
    outputs: [
      {
        name: '',
        internalType: 'struct Tick',
        type: 'tuple',
        components: [
          { name: 'next', internalType: 'uint256', type: 'uint256' },
          {
            name: 'currencyDemandQ96',
            internalType: 'uint256',
            type: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'token',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tokensRecipient',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalCleared',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalClearedQ96X7',
    outputs: [{ name: '', internalType: 'ValueX7', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint128', type: 'uint128' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'validationHook',
    outputs: [
      { name: '', internalType: 'contract IValidationHook', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'startBlock',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'endBlock',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'mps', internalType: 'uint24', type: 'uint24', indexed: false },
    ],
    name: 'AuctionStepRecorded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'bidId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokensFilled',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'currencyRefunded',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BidExited',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'priceQ96',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'amount',
        internalType: 'uint128',
        type: 'uint128',
        indexed: false,
      },
    ],
    name: 'BidSubmitted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'blockNumber',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'clearingPriceQ96',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cumulativeMps',
        internalType: 'uint24',
        type: 'uint24',
        indexed: false,
      },
    ],
    name: 'CheckpointUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'blockNumber',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'clearingPriceQ96',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ClearingPriceUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'fundsRecipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'currencyAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CurrencySwept',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'priceQ96',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'NextActiveTickUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'currency',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'protocolFeeAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ProtocolFeeTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'priceQ96',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TickInitialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'bidId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokensFilled',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TokensClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'totalSupply',
        internalType: 'uint128',
        type: 'uint128',
        indexed: false,
      },
    ],
    name: 'TokensReceived',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tokensRecipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokensAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TokensSwept',
  },
  { type: 'error', inputs: [], name: 'AuctionIsNotFinalized' },
  { type: 'error', inputs: [], name: 'AuctionIsNotOver' },
  { type: 'error', inputs: [], name: 'AuctionIsOver' },
  { type: 'error', inputs: [], name: 'AuctionNotStarted' },
  { type: 'error', inputs: [], name: 'AuctionSoldOut' },
  {
    type: 'error',
    inputs: [
      { name: 'expectedOwner', internalType: 'address', type: 'address' },
      { name: 'receivedOwner', internalType: 'address', type: 'address' },
    ],
    name: 'BatchClaimDifferentOwner',
  },
  { type: 'error', inputs: [], name: 'BidAlreadyExited' },
  { type: 'error', inputs: [], name: 'BidAmountTooSmall' },
  {
    type: 'error',
    inputs: [{ name: 'bidId', internalType: 'uint256', type: 'uint256' }],
    name: 'BidIdDoesNotExist',
  },
  { type: 'error', inputs: [], name: 'BidMustBeAboveClearingPrice' },
  { type: 'error', inputs: [], name: 'BidNotExited' },
  { type: 'error', inputs: [], name: 'BidOwnerCannotBeZeroAddress' },
  { type: 'error', inputs: [], name: 'CannotExitBid' },
  { type: 'error', inputs: [], name: 'CannotPartiallyExitBidBeforeEndBlock' },
  { type: 'error', inputs: [], name: 'CannotPartiallyExitBidBeforeGraduation' },
  { type: 'error', inputs: [], name: 'CannotSweepCurrency' },
  { type: 'error', inputs: [], name: 'CannotSweepTokens' },
  { type: 'error', inputs: [], name: 'CannotUpdateUninitializedTick' },
  { type: 'error', inputs: [], name: 'CheckpointAlreadyExistsForBlock' },
  { type: 'error', inputs: [], name: 'CheckpointBlockNotIncreasing' },
  { type: 'error', inputs: [], name: 'ClaimBlockIsBeforeEndBlock' },
  { type: 'error', inputs: [], name: 'CurrencyIsNotNative' },
  { type: 'error', inputs: [], name: 'ERC20TransferFailed' },
  {
    type: 'error',
    inputs: [
      { name: 'nextTickQ96', internalType: 'uint256', type: 'uint256' },
      { name: 'maxBidPriceQ96', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'FloorPriceAndTickSpacingGreaterThanMaxBidPrice',
  },
  { type: 'error', inputs: [], name: 'FloorPriceAndTickSpacingTooLarge' },
  { type: 'error', inputs: [], name: 'FloorPriceIsZero' },
  { type: 'error', inputs: [], name: 'FloorPriceTooLow' },
  { type: 'error', inputs: [], name: 'FundsRecipientIsZero' },
  { type: 'error', inputs: [], name: 'InvalidAmount' },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'uint256', type: 'uint256' },
      { name: 'received', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidAmountReceived',
  },
  { type: 'error', inputs: [], name: 'InvalidAuctionDataLength' },
  {
    type: 'error',
    inputs: [
      { name: 'maxPriceQ96', internalType: 'uint256', type: 'uint256' },
      { name: 'maxBidPriceQ96', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidBidPriceTooHigh',
  },
  { type: 'error', inputs: [], name: 'InvalidBidUnableToClear' },
  { type: 'error', inputs: [], name: 'InvalidEndBlock' },
  {
    type: 'error',
    inputs: [
      { name: 'actualEndBlock', internalType: 'uint64', type: 'uint64' },
      { name: 'expectedEndBlock', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'InvalidEndBlockGivenStepData',
  },
  { type: 'error', inputs: [], name: 'InvalidLastFullyFilledCheckpointHint' },
  { type: 'error', inputs: [], name: 'InvalidOutbidBlockCheckpointHint' },
  {
    type: 'error',
    inputs: [
      { name: 'actualMps', internalType: 'uint256', type: 'uint256' },
      { name: 'expectedMps', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidStepDataMps',
  },
  { type: 'error', inputs: [], name: 'InvalidTickPrice' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'InvalidToken',
  },
  { type: 'error', inputs: [], name: 'InvalidTokenAmountReceived' },
  { type: 'error', inputs: [], name: 'MpsRemainingIsZero' },
  { type: 'error', inputs: [], name: 'NativeTransferFailed' },
  {
    type: 'error',
    inputs: [
      { name: 'authorized', internalType: 'address', type: 'address' },
      { name: 'caller', internalType: 'address', type: 'address' },
    ],
    name: 'NotAuthorized',
  },
  { type: 'error', inputs: [], name: 'NotClaimable' },
  { type: 'error', inputs: [], name: 'NotGraduated' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'StepBlockDeltaCannotBeZero' },
  {
    type: 'error',
    inputs: [],
    name: 'StepLib__InvalidOffsetNotAtStepBoundary',
  },
  { type: 'error', inputs: [], name: 'StepLib__InvalidOffsetTooLarge' },
  {
    type: 'error',
    inputs: [
      { name: 'tickPriceQ96', internalType: 'uint256', type: 'uint256' },
      {
        name: 'nextActiveTickPriceQ96',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    name: 'TickHintMustBeGreaterThanNextActiveTickPrice',
  },
  { type: 'error', inputs: [], name: 'TickNotInitialized' },
  { type: 'error', inputs: [], name: 'TickPreviousPriceInvalid' },
  { type: 'error', inputs: [], name: 'TickPriceNotAtBoundary' },
  { type: 'error', inputs: [], name: 'TickPriceNotIncreasing' },
  { type: 'error', inputs: [], name: 'TickSpacingTooSmall' },
  { type: 'error', inputs: [], name: 'TokenAndCurrencyCannotBeTheSame' },
  { type: 'error', inputs: [], name: 'TokenIsAddressZero' },
  { type: 'error', inputs: [], name: 'TokenTransferFailed' },
  { type: 'error', inputs: [], name: 'TokensNotReceived' },
  { type: 'error', inputs: [], name: 'TokensRecipientIsZero' },
  { type: 'error', inputs: [], name: 'TotalSupplyIsTooLarge' },
  { type: 'error', inputs: [], name: 'TotalSupplyIsZero' },
  {
    type: 'error',
    inputs: [{ name: 'reason', internalType: 'bytes', type: 'bytes' }],
    name: 'ValidationHookCallFailed',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ContinuousClearingAuctionFactory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const continuousClearingAuctionFactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_protocolFeeController',
        internalType: 'address',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'configData', internalType: 'bytes', type: 'bytes' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'create',
    outputs: [
      {
        name: 'distributor',
        internalType: 'contract IDistributor',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'configData', internalType: 'bytes', type: 'bytes' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'sender', internalType: 'address', type: 'address' },
    ],
    name: 'getAddress',
    outputs: [
      {
        name: 'distributor',
        internalType: 'contract IDistributor',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolFeeController',
    outputs: [
      {
        name: '',
        internalType: 'contract IProtocolFeeController',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'auction',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'configData',
        internalType: 'bytes',
        type: 'bytes',
        indexed: false,
      },
    ],
    name: 'AuctionCreated',
  },
  {
    type: 'error',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidTokenAmount',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IAllowanceTransfer
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iAllowanceTransferAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'DOMAIN_SEPARATOR',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
    ],
    name: 'allowance',
    outputs: [
      { name: 'amount', internalType: 'uint160', type: 'uint160' },
      { name: 'expiration', internalType: 'uint48', type: 'uint48' },
      { name: 'nonce', internalType: 'uint48', type: 'uint48' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint160', type: 'uint160' },
      { name: 'expiration', internalType: 'uint48', type: 'uint48' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'newNonce', internalType: 'uint48', type: 'uint48' },
    ],
    name: 'invalidateNonces',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'approvals',
        internalType: 'struct IAllowanceTransfer.TokenSpenderPair[]',
        type: 'tuple[]',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'spender', internalType: 'address', type: 'address' },
        ],
      },
    ],
    name: 'lockdown',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      {
        name: 'permitBatch',
        internalType: 'struct IAllowanceTransfer.PermitBatch',
        type: 'tuple',
        components: [
          {
            name: 'details',
            internalType: 'struct IAllowanceTransfer.PermitDetails[]',
            type: 'tuple[]',
            components: [
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'amount', internalType: 'uint160', type: 'uint160' },
              { name: 'expiration', internalType: 'uint48', type: 'uint48' },
              { name: 'nonce', internalType: 'uint48', type: 'uint48' },
            ],
          },
          { name: 'spender', internalType: 'address', type: 'address' },
          { name: 'sigDeadline', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'signature', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'permit',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      {
        name: 'permitSingle',
        internalType: 'struct IAllowanceTransfer.PermitSingle',
        type: 'tuple',
        components: [
          {
            name: 'details',
            internalType: 'struct IAllowanceTransfer.PermitDetails',
            type: 'tuple',
            components: [
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'amount', internalType: 'uint160', type: 'uint160' },
              { name: 'expiration', internalType: 'uint48', type: 'uint48' },
              { name: 'nonce', internalType: 'uint48', type: 'uint48' },
            ],
          },
          { name: 'spender', internalType: 'address', type: 'address' },
          { name: 'sigDeadline', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'signature', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'permit',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'transferDetails',
        internalType: 'struct IAllowanceTransfer.AllowanceTransferDetails[]',
        type: 'tuple[]',
        components: [
          { name: 'from', internalType: 'address', type: 'address' },
          { name: 'to', internalType: 'address', type: 'address' },
          { name: 'amount', internalType: 'uint160', type: 'uint160' },
          { name: 'token', internalType: 'address', type: 'address' },
        ],
      },
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint160', type: 'uint160' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint160',
        type: 'uint160',
        indexed: false,
      },
      {
        name: 'expiration',
        internalType: 'uint48',
        type: 'uint48',
        indexed: false,
      },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'Lockdown',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newNonce',
        internalType: 'uint48',
        type: 'uint48',
        indexed: false,
      },
      {
        name: 'oldNonce',
        internalType: 'uint48',
        type: 'uint48',
        indexed: false,
      },
    ],
    name: 'NonceInvalidation',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint160',
        type: 'uint160',
        indexed: false,
      },
      {
        name: 'expiration',
        internalType: 'uint48',
        type: 'uint48',
        indexed: false,
      },
      { name: 'nonce', internalType: 'uint48', type: 'uint48', indexed: false },
    ],
    name: 'Permit',
  },
  {
    type: 'error',
    inputs: [{ name: 'deadline', internalType: 'uint256', type: 'uint256' }],
    name: 'AllowanceExpired',
  },
  { type: 'error', inputs: [], name: 'ExcessiveInvalidation' },
  {
    type: 'error',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'InsufficientAllowance',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LotFactory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const lotFactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'admin', internalType: 'address', type: 'address' },
      {
        name: 'ccaFactory_',
        internalType: 'contract IDistributorFactory',
        type: 'address',
      },
      {
        name: 'registry_',
        internalType: 'contract IAgentRegistry',
        type: 'address',
      },
      { name: 'hook_', internalType: 'address', type: 'address' },
      { name: 'settlement_', internalType: 'address', type: 'address' },
      { name: 'resolver_', internalType: 'address', type: 'address' },
      { name: 'lastBlockShareBps_', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DEFAULT_ADMIN_ROLE',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MIN_FLOOR_PER_UNIT',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'OPERATOR_ROLE',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'ccaFactory',
    outputs: [
      {
        name: '',
        internalType: 'contract IDistributorFactory',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'spec',
        internalType: 'struct LotFactory.LotSpec',
        type: 'tuple',
        components: [
          { name: 'sector', internalType: 'bytes32', type: 'bytes32' },
          { name: 'market', internalType: 'bytes32', type: 'bytes32' },
          { name: 'commodity', internalType: 'bytes32', type: 'bytes32' },
          { name: 'grade', internalType: 'bytes32', type: 'bytes32' },
          { name: 'place', internalType: 'bytes32', type: 'bytes32' },
          { name: 'currency', internalType: 'address', type: 'address' },
          { name: 'qty', internalType: 'uint256', type: 'uint256' },
          { name: 'floorPerUnit', internalType: 'uint256', type: 'uint256' },
          { name: 'durationBlocks', internalType: 'uint64', type: 'uint64' },
          {
            name: 'pickupWindowBlocks',
            internalType: 'uint64',
            type: 'uint64',
          },
          { name: 'parentLotId', internalType: 'uint256', type: 'uint256' },
          { name: 'seller', internalType: 'address', type: 'address' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    name: 'createLot',
    outputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'auction', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'spec',
        internalType: 'struct LotFactory.LotSpec',
        type: 'tuple',
        components: [
          { name: 'sector', internalType: 'bytes32', type: 'bytes32' },
          { name: 'market', internalType: 'bytes32', type: 'bytes32' },
          { name: 'commodity', internalType: 'bytes32', type: 'bytes32' },
          { name: 'grade', internalType: 'bytes32', type: 'bytes32' },
          { name: 'place', internalType: 'bytes32', type: 'bytes32' },
          { name: 'currency', internalType: 'address', type: 'address' },
          { name: 'qty', internalType: 'uint256', type: 'uint256' },
          { name: 'floorPerUnit', internalType: 'uint256', type: 'uint256' },
          { name: 'durationBlocks', internalType: 'uint64', type: 'uint64' },
          {
            name: 'pickupWindowBlocks',
            internalType: 'uint64',
            type: 'uint64',
          },
          { name: 'parentLotId', internalType: 'uint256', type: 'uint256' },
          { name: 'seller', internalType: 'address', type: 'address' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    name: 'createRelistedLot',
    outputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'auction', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'getLot',
    outputs: [
      {
        name: '',
        internalType: 'struct LotFactory.Lot',
        type: 'tuple',
        components: [
          {
            name: 'spec',
            internalType: 'struct LotFactory.LotSpec',
            type: 'tuple',
            components: [
              { name: 'sector', internalType: 'bytes32', type: 'bytes32' },
              { name: 'market', internalType: 'bytes32', type: 'bytes32' },
              { name: 'commodity', internalType: 'bytes32', type: 'bytes32' },
              { name: 'grade', internalType: 'bytes32', type: 'bytes32' },
              { name: 'place', internalType: 'bytes32', type: 'bytes32' },
              { name: 'currency', internalType: 'address', type: 'address' },
              { name: 'qty', internalType: 'uint256', type: 'uint256' },
              {
                name: 'floorPerUnit',
                internalType: 'uint256',
                type: 'uint256',
              },
              {
                name: 'durationBlocks',
                internalType: 'uint64',
                type: 'uint64',
              },
              {
                name: 'pickupWindowBlocks',
                internalType: 'uint64',
                type: 'uint64',
              },
              { name: 'parentLotId', internalType: 'uint256', type: 'uint256' },
              { name: 'seller', internalType: 'address', type: 'address' },
              { name: 'metadataURI', internalType: 'string', type: 'string' },
            ],
          },
          { name: 'auction', internalType: 'address', type: 'address' },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'startBlock', internalType: 'uint64', type: 'uint64' },
          { name: 'endBlock', internalType: 'uint64', type: 'uint64' },
          { name: 'floorQ96', internalType: 'uint256', type: 'uint256' },
          { name: 'tickSpacingQ96', internalType: 'uint256', type: 'uint256' },
          { name: 'status', internalType: 'uint8', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'role', internalType: 'bytes32', type: 'bytes32' }],
    name: 'getRoleAdmin',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'grantRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'hasRole',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'hook',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'currency', internalType: 'address', type: 'address' }],
    name: 'isCurrency',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lastBlockShareBps',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lotCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'registry',
    outputs: [
      { name: '', internalType: 'contract IAgentRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'callerConfirmation', internalType: 'address', type: 'address' },
    ],
    name: 'renounceRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'resolver',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'revokeRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'currency', internalType: 'address', type: 'address' },
      { name: 'allowed', internalType: 'bool', type: 'bool' },
    ],
    name: 'setCurrency',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'settlement',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'currency',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'allowed', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'CurrencySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'seller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'market',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'auction',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'currency',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'sector',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'commodity',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'place',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      { name: 'qty', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'floorPerUnit',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'startBlock',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
      {
        name: 'endBlock',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
      {
        name: 'parentLotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'metadataURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'LotListed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'previousAdminRole',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'newAdminRole',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'RoleAdminChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RoleGranted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RoleRevoked',
  },
  { type: 'error', inputs: [], name: 'AccessControlBadConfirmation' },
  {
    type: 'error',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'neededRole', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'AccessControlUnauthorizedAccount',
  },
  {
    type: 'error',
    inputs: [{ name: 'currency', internalType: 'address', type: 'address' }],
    name: 'CurrencyNotAllowed',
  },
  {
    type: 'error',
    inputs: [{ name: 'duration', internalType: 'uint256', type: 'uint256' }],
    name: 'DurationTooLong',
  },
  {
    type: 'error',
    inputs: [
      { name: 'durationBlocks', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'DurationTooShort',
  },
  {
    type: 'error',
    inputs: [{ name: 'duration', internalType: 'uint256', type: 'uint256' }],
    name: 'DurationTooShort',
  },
  {
    type: 'error',
    inputs: [
      { name: 'floorPerUnit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'FloorTooLow',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotAuthorized',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotSettlement',
  },
  {
    type: 'error',
    inputs: [{ name: 'qty', internalType: 'uint256', type: 'uint256' }],
    name: 'QtyTooLarge',
  },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
  {
    type: 'error',
    inputs: [{ name: 'seller', internalType: 'address', type: 'address' }],
    name: 'SellerCannotList',
  },
  {
    type: 'error',
    inputs: [{ name: 'shareBps', internalType: 'uint256', type: 'uint256' }],
    name: 'ShareTooHigh',
  },
  {
    type: 'error',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'UnknownLot',
  },
  {
    type: 'error',
    inputs: [{ name: 'parentLotId', internalType: 'uint256', type: 'uint256' }],
    name: 'UnknownParent',
  },
  {
    type: 'error',
    inputs: [{ name: 'sector', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UnknownSector',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
  { type: 'error', inputs: [], name: 'ZeroPickupWindow' },
  { type: 'error', inputs: [], name: 'ZeroQty' },
  { type: 'error', inputs: [], name: 'ZeroTick' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LotToken
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const lotTokenAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'name_', internalType: 'string', type: 'string' },
      { name: 'symbol_', internalType: 'string', type: 'string' },
      { name: 'supply', internalType: 'uint256', type: 'uint256' },
      { name: 'mintTo', internalType: 'address', type: 'address' },
      { name: 'settlement_', internalType: 'address', type: 'address' },
      { name: 'resolver_', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'burnFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'escrowFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'resolver',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'settlement',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Transfer',
  },
  {
    type: 'error',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'allowance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientAllowance',
  },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientBalance',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'spender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSpender',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotSettlement',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotSettlementOrResolver',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MarketSettlement
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const marketSettlementAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'admin', internalType: 'address', type: 'address' },
      {
        name: 'factory_',
        internalType: 'contract LotFactory',
        type: 'address',
      },
      {
        name: 'trigger_',
        internalType: 'contract IChainTrigger',
        type: 'address',
      },
      { name: 'resolver_', internalType: 'address', type: 'address' },
      { name: 'treasury_', internalType: 'address', type: 'address' },
      {
        name: 'p',
        internalType: 'struct MarketSettlement.Params',
        type: 'tuple',
        components: [
          { name: 'feeBps', internalType: 'uint16', type: 'uint16' },
          { name: 'advanceNewBps', internalType: 'uint16', type: 'uint16' },
          { name: 'advanceProvenBps', internalType: 'uint16', type: 'uint16' },
          { name: 'advanceTruckBps', internalType: 'uint16', type: 'uint16' },
          { name: 'provenAfter', internalType: 'uint32', type: 'uint32' },
          {
            name: 'contestWindowBlocks',
            internalType: 'uint64',
            type: 'uint64',
          },
          {
            name: 'reportWindowBlocks',
            internalType: 'uint64',
            type: 'uint64',
          },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DEFAULT_ADMIN_ROLE',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'HANDOVER_TYPEHASH',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'OPERATOR_ROLE',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'TOKEN_DUST',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'seller', internalType: 'address', type: 'address' },
      { name: 'sector', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'advanceBpsFor',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'advanceNewBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'advanceProvenBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'advanceTruckBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'truckLotId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'assignCarrier',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
      { name: 'tokenAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'expiryBlock', internalType: 'uint64', type: 'uint64' },
      { name: 'sellerSig', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'confirmHandover',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
      { name: 'evidenceHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'evidenceURI', internalType: 'string', type: 'string' },
    ],
    name: 'contestNoShow',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'contestWindowBlocks',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { name: 'fields', internalType: 'bytes1', type: 'bytes1' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'version', internalType: 'string', type: 'string' },
      { name: 'chainId', internalType: 'uint256', type: 'uint256' },
      { name: 'verifyingContract', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'extensions', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [
      { name: '', internalType: 'contract LotFactory', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'feeBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
    ],
    name: 'finalizeNoShow',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'role', internalType: 'bytes32', type: 'bytes32' }],
    name: 'getRoleAdmin',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'grantRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
      { name: 'tokenAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'expiryBlock', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'handoverDigest',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'hasRole',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'heldOf',
    outputs: [
      { name: 'held', internalType: 'uint256', type: 'uint256' },
      { name: 'soldTokens', internalType: 'uint256', type: 'uint256' },
      { name: 'pickupDeadline', internalType: 'uint64', type: 'uint64' },
      { name: 'carrier', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'seller', internalType: 'address', type: 'address' },
      { name: 'proven', internalType: 'bool', type: 'bool' },
    ],
    name: 'markProven',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'provenAfter',
    outputs: [{ name: '', internalType: 'uint32', type: 'uint32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'reclaimUnsold',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'releaseExpired',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'newFloorPerUnit', internalType: 'uint256', type: 'uint256' },
      { name: 'durationBlocks', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'relist',
    outputs: [{ name: 'newLotId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'callerConfirmation', internalType: 'address', type: 'address' },
    ],
    name: 'renounceRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'tokenAmount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'reportNoShow',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
    ],
    name: 'reportOf',
    outputs: [
      { name: 'open', internalType: 'bool', type: 'bool' },
      { name: 'contested', internalType: 'bool', type: 'bool' },
      { name: 'contestEnds', internalType: 'uint64', type: 'uint64' },
      { name: 'tokens', internalType: 'uint256', type: 'uint256' },
      { name: 'disputeId', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'reportWindowBlocks',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'resolveRuling',
    outputs: [],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'resolver',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'revokeRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'saleOf',
    outputs: [
      {
        name: '',
        internalType: 'struct MarketSettlement.Sale',
        type: 'tuple',
        components: [
          { name: 'settled', internalType: 'bool', type: 'bool' },
          { name: 'released', internalType: 'bool', type: 'bool' },
          { name: 'complete', internalType: 'bool', type: 'bool' },
          { name: 'anyRefund', internalType: 'bool', type: 'bool' },
          { name: 'paidInFull', internalType: 'bool', type: 'bool' },
          { name: 'unsoldResolved', internalType: 'bool', type: 'bool' },
          { name: 'status', internalType: 'uint8', type: 'uint8' },
          { name: 'advanceBps', internalType: 'uint16', type: 'uint16' },
          { name: 'pickupDeadline', internalType: 'uint64', type: 'uint64' },
          { name: 'seller', internalType: 'address', type: 'address' },
          { name: 'currency', internalType: 'address', type: 'address' },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'carrier', internalType: 'address', type: 'address' },
          { name: 'sector', internalType: 'bytes32', type: 'bytes32' },
          { name: 'parentLotId', internalType: 'uint256', type: 'uint256' },
          { name: 'truckLotId', internalType: 'uint256', type: 'uint256' },
          { name: 'soldTokens', internalType: 'uint256', type: 'uint256' },
          { name: 'heldRemaining', internalType: 'uint256', type: 'uint256' },
          { name: 'outstanding', internalType: 'uint256', type: 'uint256' },
          { name: 'reportedTokens', internalType: 'uint256', type: 'uint256' },
          { name: 'unsold', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'seller', internalType: 'address', type: 'address' }],
    name: 'sellerRecord',
    outputs: [
      { name: 'cleanLots', internalType: 'uint32', type: 'uint32' },
      { name: 'noShows', internalType: 'uint32', type: 'uint32' },
      { name: 'proven', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'settle',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'statusOf',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'digest', internalType: 'bytes32', type: 'bytes32' }],
    name: 'ticketUsed',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'trigger',
    outputs: [
      { name: '', internalType: 'contract IChainTrigger', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'truckLotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'carrier',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'CarrierAssigned',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'EIP712DomainChanged' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'receiver',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'releasedToSeller',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'HandoverConfirmed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'HeldReleased',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'truckLotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LotDelivered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'LotPaidInFull',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'newLotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'newFloorPerUnit',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LotRelisted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'finalClearingPerUnit',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'avgPerUnit',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'soldUnits',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'raised',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'sellerPaid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'held',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'fee', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'advanceBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
      {
        name: 'pickupDeadline',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'LotSettled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'disputeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'NoShowContested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'seller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'refund',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'NoShowRefunded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'contestEnds',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'NoShowReported',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'previousAdminRole',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'newAdminRole',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'RoleAdminChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RoleGranted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RoleRevoked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'lotId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'refundToBuyer',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'paidToSeller',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RulingSettled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'seller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'cleanLots',
        internalType: 'uint32',
        type: 'uint32',
        indexed: false,
      },
      {
        name: 'noShows',
        internalType: 'uint32',
        type: 'uint32',
        indexed: false,
      },
      { name: 'proven', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'SellerRecordUpdated',
  },
  { type: 'error', inputs: [], name: 'AccessControlBadConfirmation' },
  {
    type: 'error',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'neededRole', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'AccessControlUnauthorizedAccount',
  },
  {
    type: 'error',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
    ],
    name: 'AlreadyContested',
  },
  {
    type: 'error',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
    ],
    name: 'AlreadyReported',
  },
  {
    type: 'error',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'AlreadySettled',
  },
  {
    type: 'error',
    inputs: [
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'available', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'AmountTooHigh',
  },
  {
    type: 'error',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'endBlock', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'AuctionNotOver',
  },
  { type: 'error', inputs: [], name: 'BadParams' },
  { type: 'error', inputs: [], name: 'BadSignature' },
  {
    type: 'error',
    inputs: [{ name: 'bps', internalType: 'uint256', type: 'uint256' }],
    name: 'BpsTooHigh',
  },
  {
    type: 'error',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'CarrierAlreadyAssigned',
  },
  {
    type: 'error',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
    ],
    name: 'Contested',
  },
  {
    type: 'error',
    inputs: [
      { name: 'newFloor', internalType: 'uint256', type: 'uint256' },
      { name: 'oldFloor', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'FloorNotLower',
  },
  {
    type: 'error',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'HeldAlreadyReleased',
  },
  { type: 'error', inputs: [], name: 'InvalidShortString' },
  {
    type: 'error',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'LotClosed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
    ],
    name: 'NoOpenReport',
  },
  { type: 'error', inputs: [], name: 'NoResolver' },
  {
    type: 'error',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'buyer', internalType: 'address', type: 'address' },
    ],
    name: 'NoShowOpen',
  },
  {
    type: 'error',
    inputs: [{ name: 'truckLotId', internalType: 'uint256', type: 'uint256' }],
    name: 'NotATruckLot',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotBuyerOrCarrier',
  },
  { type: 'error', inputs: [], name: 'NotImplemented' },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotResolver',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotSeller',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotSellerOrOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'NotSold',
  },
  {
    type: 'error',
    inputs: [{ name: 'lotId', internalType: 'uint256', type: 'uint256' }],
    name: 'NothingUnsold',
  },
  {
    type: 'error',
    inputs: [
      { name: 'lotId', internalType: 'uint256', type: 'uint256' },
      { name: 'truckParentLotId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ParentMismatch',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
  {
    type: 'error',
    inputs: [{ name: 'str', internalType: 'string', type: 'string' }],
    name: 'StringTooLong',
  },
  {
    type: 'error',
    inputs: [{ name: 'digest', internalType: 'bytes32', type: 'bytes32' }],
    name: 'TicketAlreadyUsed',
  },
  {
    type: 'error',
    inputs: [{ name: 'expiryBlock', internalType: 'uint64', type: 'uint64' }],
    name: 'TicketExpired',
  },
  {
    type: 'error',
    inputs: [
      { name: 'opensAfterBlock', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'TooEarly',
  },
  {
    type: 'error',
    inputs: [{ name: 'truckLotId', internalType: 'uint256', type: 'uint256' }],
    name: 'TruckNotSold',
  },
  {
    type: 'error',
    inputs: [
      { name: 'closedAfterBlock', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'WindowClosed',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
  { type: 'error', inputs: [], name: 'ZeroAmount' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MockStable
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const mockStableAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'name_', internalType: 'string', type: 'string' },
      { name: 'symbol_', internalType: 'string', type: 'string' },
      { name: 'admin', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DEFAULT_ADMIN_ROLE',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DRIP_AMOUNT',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DRIP_INTERVAL',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'OPERATOR_ROLE',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'to', internalType: 'address', type: 'address' }],
    name: 'drip',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'role', internalType: 'bytes32', type: 'bytes32' }],
    name: 'getRoleAdmin',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'grantRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'hasRole',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'to', internalType: 'address', type: 'address' }],
    name: 'nextDripAt',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'callerConfirmation', internalType: 'address', type: 'address' },
    ],
    name: 'renounceRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'revokeRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'previousAdminRole',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'newAdminRole',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'RoleAdminChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RoleGranted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RoleRevoked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Transfer',
  },
  { type: 'error', inputs: [], name: 'AccessControlBadConfirmation' },
  {
    type: 'error',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'neededRole', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'AccessControlUnauthorizedAccount',
  },
  {
    type: 'error',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'nextDripAt', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'DripTooSoon',
  },
  {
    type: 'error',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'allowance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientAllowance',
  },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientBalance',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'spender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSpender',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// StubDisputeResolver
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const stubDisputeResolverAbi = [
  { type: 'fallback', stateMutability: 'payable' },
  { type: 'error', inputs: [], name: 'NotImplemented' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// StubSignalOracle
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const stubSignalOracleAbi = [
  { type: 'fallback', stateMutability: 'payable' },
  { type: 'error', inputs: [], name: 'NotImplemented' },
] as const
