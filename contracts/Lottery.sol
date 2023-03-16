// SPDX-License-Identifier: MIT
//Lottery contract
//Enter the lottery
//Pick a random winner
//Winner to be seclected periodically -> completed automated
//Chainlink Oracle -> Randomness and automatic execution

pragma solidity >=0.6.0 <0.9.0;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
// import "@chainlink/contracts/src/v0.8/AutomationCompatible.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

error Lottery__NotEnoughETHEntered();
error Lottery__TransferFailed();
error Lottery__NotOpen();
error Lottery__UpkeepNotNeeded(uint currentBalance, uint numPlayers, uint lotteryState);

/**
 * @title A sample Lottery Contract
 * @author Gerard Do
 * @notice This contract is for creating immutable decentralised smart contract
 * @dev this implements Chainlink VRF v2 and Chainlink Keeper
 */

contract Lottery is VRFConsumerBaseV2, KeeperCompatibleInterface {
    /*Type declaration*/
    enum LotteryState {
        OPEN,
        CALCULATING
    }

    /* State variable */
    uint private immutable i_entranceFee;
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint32 private constant NUM_WORD = 1;

    /* Lottery variables */
    address private s_recentWinner;
    LotteryState private s_lotteryState;
    uint256 private s_lastTimeStamp;
    uint private immutable i_interval;

    /*Events */
    event LotteryEnter(address indexed player);
    event RequestedLotteryWinner(uint indexed requestId);
    event WinnerPicked(address indexed winner);

    constructor(
        address vrfCoordinatorV2,
        uint entranceFee,
        bytes32 gasLane,
        uint64 subscriptionId,
        uint32 callbackGasLimit,
        uint interval
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;
        s_lotteryState = LotteryState.OPEN;
        s_lastTimeStamp = block.timestamp;
        i_interval = interval;
    }

    /* Function */
    function enterLottery() public payable {
        // require(msg.value >= i_entranceFee, "Not enough ETH to enter!")
        if (msg.value < i_entranceFee) {
            revert Lottery__NotEnoughETHEntered();
        }
        if (s_lotteryState != LotteryState.OPEN) {
            revert Lottery__NotOpen();
        }
        s_players.push(payable(msg.sender));
        emit LotteryEnter(msg.sender);
    }

    /*
     * @dev this is the function the Chainlink Keeper nodes call
     * they look for the "upkeepNeed" to return true
     * The following should be true when:
     *1. The time interval has passed
     *2. The lottery should have at least 1 player, and have some ETH
     *3. Our subscription is funded with LINK
     *4. The lottery should be in open state
     */

    function checkUpkeep(
        bytes memory /*checkData*/
    ) public override returns (bool upkeepNeeded, bytes memory /*performData */) {
        bool isOpen = (LotteryState.OPEN == s_lotteryState);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) >= i_interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
    }

    function performUpkeep(bytes calldata /*performData*/) external override {
        //Request the random number\
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert Lottery__UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint(s_lotteryState)
            );
        }
        s_lotteryState = LotteryState.CALCULATING;
        uint requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORD
        );
        emit RequestedLotteryWinner(requestId);
    }

    function fulfillRandomWords(uint /* requestId */, uint[] memory randomWords) internal override {
        uint indexOfWinner = randomWords[0] % s_players.length;
        address payable recenWinner = s_players[indexOfWinner];
        s_recentWinner = recenWinner;
        s_lotteryState = LotteryState.OPEN;
        s_players = new address payable[](0);
        s_lastTimeStamp = block.timestamp;
        (bool success, ) = recenWinner.call{value: address(this).balance}("");

        if (!success) {
            revert Lottery__TransferFailed();
        }
        emit WinnerPicked(s_recentWinner);
    }

    /*View / Pure functions */

    function getEntranceFee() public view returns (uint) {
        return i_entranceFee;
    }

    function getPlayers(uint index) public view returns (address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getLotteryState() public view returns (LotteryState) {
        return s_lotteryState;
    }

    function getNumWords() public pure returns (uint) {
        return NUM_WORD;
    }

    function getNumberofPlayers() public view returns (uint) {
        return s_players.length;
    }

    function getLatestTimestamp() public view returns (uint) {
        return s_lastTimeStamp;
    }

    function getRequestConfirmations() public pure returns (uint) {
        return REQUEST_CONFIRMATIONS;
    }

    function getInterval() public view returns (uint) {
        return i_interval;
    }
}
