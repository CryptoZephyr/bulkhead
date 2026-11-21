// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./lib/QorePrecompiles.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
}

/// @title BulkheadAccount
/// @notice Damage-bounded money. Funds sit behind walls whose height is fixed in advance:
///         - Everyday: the everyday key spends freely within a per-transaction cap, a period cap
///           and an optional payee list. That is its blast radius.
///         - Savings: a floor per asset. Everyday spends can never take the balance below it.
///           Only the Safety key (ML-DSA-87, on the phone) moves money below the floor.
///         - Agent: a separate chain account with its own spending rule. This account tops it up,
///           and only through a Safety-key approval.
///         Tightening any wall is instant. Widening one needs the Safety key and waits out a delay,
///         and any tighten cancels every queued widening. Tripwires seal the account inside the
///         offending transaction without reverting, so the seal survives the attacker's own call.
/// @dev    No admin, no proxy, no ecrecover. Every contract in the owner's EVM window scope can
///         verify the owner's ECDSA signatures, so this contract must never be one that does.
contract BulkheadAccount {
    // ------------------------------------------------------------------ types

    struct Policy {
        uint256 perTxCap;   // max per everyday spend
        uint256 periodCap;  // max everyday outflow per period
        uint256 floor;      // Savings: balance everyday spends may never go below
    }

    enum Loosen { SetPolicy, AddPayee, DisablePayeeList, Unseal, AddSentinel, SetRecovery }

    enum Trip { None, OverTxCap, OverPeriodCap, BelowFloor, UnknownPayee }

    // ------------------------------------------------------------------ constants

    bytes32 public constant TAG = keccak256("BULKHEAD_V1");
    address public constant NATIVE = address(0);
    uint256 public constant MAX_THROTTLES_PER_PERIOD = 1; // K: per sentinel per period
    // T: one sentinel throttle lasts at most half a period (see maxThrottleBlocks)

    // ------------------------------------------------------------------ immutable config

    address public immutable everyday;      // laptop key (EVM address of the user's account)
    address public immutable safety;        // phone account whose proven ML-DSA-87 key authorises widening
    address public immutable factory;
    uint256 public immutable periodBlocks;
    uint256 public immutable loosenDelay;   // D, in blocks

    // ------------------------------------------------------------------ state

    address public recovery;                // pinned break-glass destination, another Bulkhead account
    bool public sealed_;
    uint256 public throttledUntil;
    Trip public lastTrip;

    mapping(address => Policy) public policy;            // per asset
    // Period cap as a refilling allowance: at most periodCap is available, and it refills linearly
    // over periodBlocks. Unlike fixed windows, a burst across a period boundary cannot reach 2x.
    mapping(address => uint256) public allowanceUsed;    // per asset, debt against periodCap
    mapping(address => uint256) public lastSpendBlock;   // per asset

    bool public payeeListOn;
    mapping(address => bool) public payee;

    mapping(address => bool) public sentinel;
    mapping(address => uint256) public sentinelPeriod;
    mapping(address => uint256) public sentinelUses;

    mapping(uint256 => bool) public nonceUsed;           // Safety-key signatures, single use
    uint256 public epoch;                                // bumped by every tighten, cancels queued widening
    mapping(bytes32 => uint256) public readyAt;          // queued widening: id => block it may run
    mapping(bytes32 => uint256) public queuedEpoch;

    uint256 private locked = 1;

    // ------------------------------------------------------------------ events

    event Spent(address indexed asset, address indexed to, uint256 amount, bool withApproval);
    event Tripped(Trip reason, address indexed asset, address indexed to, uint256 amount);
    event Sealed(address by);
    event Throttled(address indexed by, uint256 untilBlock);
    event Tightened(string what);
    event LoosenQueued(bytes32 indexed id, Loosen action, bytes data, uint256 readyAt);
    event LoosenExecuted(bytes32 indexed id, Loosen action);
    event LoosenCancelled(uint256 newEpoch);
    event BrokeGlass(address indexed asset, address indexed to, uint256 amount);

    // ------------------------------------------------------------------ errors

    error NotEveryday();
    error NotSentinel();
    error NotTighter();
    error ThrottleTooLong();
    error ThrottleBudgetUsed();
    error Expired();
    error NonceReused();
    error NoSafetyKey();
    error SafetyKeyNotProven();
    error BadSafetySignature();
    error NotQueued();
    error TooEarly();
    error CancelledByTighten();
    error NoRecovery();
    error RecoveryNotAccount();
    error TransferFailed();
    error Reentrant();

    // ------------------------------------------------------------------ modifiers

    modifier onlyEveryday() {
        if (msg.sender != everyday) revert NotEveryday();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrant();
        locked = 2;
        _;
        locked = 1;
    }

    // ------------------------------------------------------------------ setup

    struct Init {
        address everyday;
        address safety;
        address recovery;          // may be zero at creation, set later by a Safety-key widening
        uint256 periodBlocks;
        uint256 loosenDelay;
        address[] assets;
        Policy[] policies;
        address[] payees;          // non-empty turns the payee list on
    }

    constructor(Init memory i) {
        everyday = i.everyday;
        safety = i.safety;
        factory = msg.sender;
        periodBlocks = i.periodBlocks;
        loosenDelay = i.loosenDelay;
        recovery = i.recovery;
        for (uint256 k = 0; k < i.assets.length; k++) policy[i.assets[k]] = i.policies[k];
        if (i.payees.length > 0) {
            payeeListOn = true;
            for (uint256 k = 0; k < i.payees.length; k++) payee[i.payees[k]] = true;
        }
    }

    receive() external payable {}

    // ------------------------------------------------------------------ views

    function balanceOf(address asset) public view returns (uint256) {
        return asset == NATIVE ? address(this).balance : IERC20Min(asset).balanceOf(address(this));
    }

    /// Everyday blast radius left for `asset` right now: what the everyday key could still move.
    function maxThrottleBlocks() public view returns (uint256) {
        return periodBlocks / 2;
    }

    function blastRadius(address asset) external view returns (uint256) {
        if (sealed_ || block.number < throttledUntil) return 0;
        Policy memory p = policy[asset];
        uint256 used = _used(asset, p.periodCap);
        uint256 periodLeft = p.periodCap > used ? p.periodCap - used : 0;
        uint256 bal = balanceOf(asset);
        uint256 aboveFloor = bal > p.floor ? bal - p.floor : 0;
        uint256 r = p.perTxCap < periodLeft ? p.perTxCap : periodLeft;
        return r < aboveFloor ? r : aboveFloor;
    }

    function digest(uint8 kind, bytes memory data, uint256 nonce, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(TAG, block.chainid, address(this), kind, keccak256(data), nonce, deadline));
    }

    // ------------------------------------------------------------------ everyday spending

    /// @notice Everyday spend. Never reverts on a policy breach: it trips, seals and returns false,
    ///         so the seal is recorded even though the attacker's transaction "succeeds".
    function spend(address asset, address to, uint256 amount) external onlyEveryday nonReentrant returns (bool) {
        if (sealed_ || block.number < throttledUntil) return false;
        Policy memory p = policy[asset];
        uint256 used = _used(asset, p.periodCap);
        Trip t = Trip.None;
        if (amount > p.perTxCap) t = Trip.OverTxCap;
        else if (used + amount > p.periodCap) t = Trip.OverPeriodCap;
        else if (balanceOf(asset) < p.floor + amount) t = Trip.BelowFloor;
        else if (payeeListOn && !payee[to]) t = Trip.UnknownPayee;
        if (t != Trip.None) {
            sealed_ = true;
            lastTrip = t;
            _bumpEpoch();
            emit Tripped(t, asset, to, amount);
            emit Sealed(address(this));
            return false;
        }
        allowanceUsed[asset] = used + amount;
        lastSpendBlock[asset] = block.number;
        _transfer(asset, to, amount);
        emit Spent(asset, to, amount, false);
        return true;
    }

    // ------------------------------------------------------------------ Safety-key actions (immediate)

    /// @notice Spend beyond the everyday walls (over a cap, below the floor, to a new payee, or a
    ///         top-up of the Agent account). Needs a fresh ML-DSA-87 signature from the Safety key.
    ///         Works while sealed: the phone is the authority the seal protects.
    function spendWithApproval(address asset, address to, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig)
        external nonReentrant
    {
        _checkSafety(0, abi.encode(asset, to, amount), nonce, deadline, sig);
        _transfer(asset, to, amount);
        emit Spent(asset, to, amount, true);
    }

    /// @notice Break-glass with the Safety key, relayed by anyone.
    function breakGlassWithApproval(address[] calldata assets, uint256 nonce, uint256 deadline, bytes calldata sig)
        external nonReentrant
    {
        _checkSafety(1, abi.encode(assets), nonce, deadline, sig);
        _evacuate(assets);
    }

    // ------------------------------------------------------------------ break-glass (everyday key)

    /// @notice The everyday key may evacuate too: the destination was pinned by the Safety key,
    ///         so a stolen laptop can only send funds to safety.
    function breakGlass(address[] calldata assets) external onlyEveryday nonReentrant {
        _evacuate(assets);
    }

    // ------------------------------------------------------------------ tighten (instant)

    function seal() external onlyEveryday {
        sealed_ = true;
        _bumpEpoch();
        emit Sealed(msg.sender);
    }

    /// @notice Lower caps or raise the Savings floor. Every field must be at least as strict.
    function tightenPolicy(address asset, Policy calldata p) external onlyEveryday {
        Policy memory c = policy[asset];
        if (p.perTxCap > c.perTxCap || p.periodCap > c.periodCap || p.floor < c.floor) revert NotTighter();
        policy[asset] = p;
        _bumpEpoch();
        emit Tightened("policy");
    }

    function removePayee(address who) external onlyEveryday {
        payee[who] = false;
        _bumpEpoch();
        emit Tightened("payee");
    }

    function enablePayeeList() external onlyEveryday {
        payeeListOn = true;
        _bumpEpoch();
        emit Tightened("payee-list");
    }

    function removeSentinel(address who) external onlyEveryday {
        sentinel[who] = false;
        _bumpEpoch();
        emit Tightened("sentinel");
    }

    /// @notice Cancel every queued widening without changing anything else.
    function cancelLoosens() external onlyEveryday {
        _bumpEpoch();
    }

    /// @notice A sentinel can only pause everyday spending for at most half a period, once per
    ///         period, so spending stays available at least half the time. It cannot seal, move
    ///         funds, widen anything, or cancel the Safety key's queued widenings.
    function throttle(uint256 blocks_) external {
        if (!sentinel[msg.sender]) revert NotSentinel();
        if (blocks_ > maxThrottleBlocks()) revert ThrottleTooLong();
        uint256 p = block.number / periodBlocks;
        if (sentinelPeriod[msg.sender] != p) { sentinelPeriod[msg.sender] = p; sentinelUses[msg.sender] = 0; }
        if (sentinelUses[msg.sender] >= MAX_THROTTLES_PER_PERIOD) revert ThrottleBudgetUsed();
        sentinelUses[msg.sender]++;
        uint256 until_ = block.number + blocks_;
        if (until_ > throttledUntil) throttledUntil = until_;
        emit Throttled(msg.sender, until_);
    }

    // ------------------------------------------------------------------ widen (Safety key + delay)

    /// @notice Queue a widening signed by the Safety key. It may run after `loosenDelay` blocks,
    ///         unless a tighten happens first.
    function queueLoosen(Loosen action, bytes calldata data, uint256 nonce, uint256 deadline, bytes calldata sig)
        external returns (bytes32 id)
    {
        _checkSafety(uint8(16 + uint8(action)), data, nonce, deadline, sig);
        id = keccak256(abi.encode(action, data, nonce));
        readyAt[id] = block.number + loosenDelay;
        queuedEpoch[id] = epoch;
        emit LoosenQueued(id, action, data, readyAt[id]);
    }

    /// @notice Anyone may run a widening once its delay has passed.
    function executeLoosen(Loosen action, bytes calldata data, uint256 nonce) external nonReentrant {
        bytes32 id = keccak256(abi.encode(action, data, nonce));
        uint256 r = readyAt[id];
        if (r == 0) revert NotQueued();
        if (block.number < r) revert TooEarly();
        if (queuedEpoch[id] != epoch) revert CancelledByTighten();
        delete readyAt[id];

        if (action == Loosen.SetPolicy) {
            (address asset, Policy memory p) = abi.decode(data, (address, Policy));
            policy[asset] = p;
        } else if (action == Loosen.AddPayee) {
            payee[abi.decode(data, (address))] = true;
        } else if (action == Loosen.DisablePayeeList) {
            payeeListOn = false;
        } else if (action == Loosen.Unseal) {
            sealed_ = false;
            throttledUntil = 0;
            lastTrip = Trip.None;
        } else if (action == Loosen.AddSentinel) {
            sentinel[abi.decode(data, (address))] = true;
        } else if (action == Loosen.SetRecovery) {
            address r_ = abi.decode(data, (address));
            if (!IBulkheadFactory(factory).isAccount(r_) || r_ == address(this)) revert RecoveryNotAccount();
            recovery = r_;
        }
        emit LoosenExecuted(id, action);
    }

    // ------------------------------------------------------------------ internals

    /// Allowance used, after linear refill since the last spend.
    function _used(address asset, uint256 periodCap) internal view returns (uint256) {
        uint256 u = allowanceUsed[asset];
        if (u == 0) return 0;
        uint256 refill = (periodCap * (block.number - lastSpendBlock[asset])) / periodBlocks;
        return refill >= u ? 0 : u - refill;
    }

    function _bumpEpoch() internal {
        epoch++;
        emit LoosenCancelled(epoch);
    }

    /// The Safety key is read from chain state on every call, so rotation is followed and an
    /// unproven key never authorises anything. An inactive precompile reverts (fail closed).
    function _checkSafety(uint8 kind, bytes memory data, uint256 nonce, uint256 deadline, bytes calldata sig) internal {
        if (block.timestamp > deadline) revert Expired();
        if (nonceUsed[nonce]) revert NonceReused();
        (bool registered, , bytes memory pk, bool proven) = QorePQC.keyOf(safety);
        if (!registered || pk.length == 0) revert NoSafetyKey();
        if (!proven) revert SafetyKeyNotProven();
        if (!QorePQC.verify(pk, sig, abi.encodePacked(digest(kind, data, nonce, deadline)))) revert BadSafetySignature();
        nonceUsed[nonce] = true;
    }

    function _evacuate(address[] calldata assets) internal {
        address r = recovery;
        if (r == address(0)) revert NoRecovery();
        sealed_ = true;
        _bumpEpoch();
        for (uint256 k = 0; k < assets.length; k++) {
            uint256 amt = balanceOf(assets[k]);
            if (amt > 0) {
                _transfer(assets[k], r, amt);
                emit BrokeGlass(assets[k], r, amt);
            }
        }
    }

    /// Tolerates ERC-20s that return nothing; reverts on an explicit false.
    function _transfer(address asset, address to, uint256 amount) internal {
        if (asset == NATIVE) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
            return;
        }
        (bool ok2, bytes memory ret) = asset.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok2 || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}

interface IBulkheadFactory {
    function isAccount(address) external view returns (bool);
}
