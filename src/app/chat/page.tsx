'use client';
export const dynamic = 'force-dynamic';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send, Bot, User, Zap, LayoutDashboard } from 'lucide-react';
import { authenticatedFetch } from '../utils/auth';
import io from 'socket.io-client';
import Link from 'next/link';
import { useSocket } from '../context/socketContext'; 
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletSendTransactionError } from '@solana/wallet-adapter-base';

interface AppUser {
    id: number;
    walletAddress: string;
    name: string | null;
    email: string | null
}

interface Budget {
    amount: number;
    currency: 'NGN' | 'USD';
    startDate: string; 
}

interface Expense {
    amountUSD: number | null;
    amountNGN: number | null;
    type: 'income' | 'expense';
    createdAt: string;
}

interface Goal {
    id: number;
    name: string;
    targetAmount: number;
    currentAmount: number;
    type: 'SAVINGS' | 'INVESTMENT';
    currency: 'NGN' | 'USD';
}

interface NameInputModalProps {
    onSubmit: (name: string, email: string) => void;
    walletAddress: string;
}

const NameInputModal: React.FC<NameInputModalProps> = ({ onSubmit, walletAddress }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [emailError, setEmailError] = useState('');

    const validateEmail = (email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    const handleSubmit = () => {
        if (!name.trim()) {
            return;
        }
        
        if (!email.trim()) {
            setEmailError('Email is required');
            return;
        }
        
        if (!validateEmail(email.trim())) {
            setEmailError('Please enter a valid email address');
            return;
        }
        
        setEmailError('');
        onSubmit(name.trim(), email.trim());
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-xl p-8 shadow-2xl max-w-sm w-full">
                <h2 className="text-lg font-bold mb-4 text-white">Welcome!</h2>
                <p className="text-gray-400 mb-4 text-sm">
                    Please enter your details to personalize your experience.
                </p>
                
                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Your name"
                            className="w-full px-3 py-2 rounded bg-gray-800 text-white border border-gray-700 focus:outline-none focus:border-purple-500 transition-colors"
                        />
                    </div>
                    
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => {
                                setEmail(e.target.value);
                                setEmailError('');
                            }}
                            onKeyPress={handleKeyPress}
                            placeholder="your.email@example.com"
                            className="w-full px-3 py-2 rounded bg-gray-800 text-white border border-gray-700 focus:outline-none focus:border-purple-500 transition-colors"
                        />
                        {emailError && (
                            <p className="text-red-400 text-xs mt-1">{emailError}</p>
                        )}
                    </div>
                </div>
                
                <button
                    onClick={handleSubmit}
                    disabled={!name.trim() || !email.trim()}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded font-bold transition mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Continue
                </button>
                
                <p className="text-xs text-gray-500 mt-4 text-center font-mono opacity-60">
                    Wallet: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </p>
            </div>
        </div>
    );
};

const getInitialMessages = () => {
  if (typeof window !== 'undefined') {
    const savedMessages = localStorage.getItem('chat_history');
    if (savedMessages) {
      try {
        return JSON.parse(savedMessages);
      } catch (e) {
        console.error("Failed to parse chat history from localStorage", e);
      }
    }
  }
  return [
    { id: 1, type: 'ai', content: "Hey there! I'm LyraAI, your personal financial AI Agent.", timestamp: new Date().toLocaleTimeString() }
  ];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const fetchUserGoals = async (walletAddress: string): Promise<Goal[]> => {
    try {
        const res = await authenticatedFetch(`${API_URL}/api/goals/${walletAddress}`);
        const data = await res.json();
        if (data.success && data.goals) {
            return data.goals;
        }
        return [];
    } catch (error) {
        console.error("Failed to fetch goals:", error);
        return [];
    }
};

function ChatPageContent() {
    const [messages, setMessages] = useState(getInitialMessages);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [user, setUser] = useState<AppUser | null>(null);
    const [showNameModal, setShowNameModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const { socket } = useSocket();
    const [surplus, setSurplus] = useState(0);
    const [budget, setBudget] = useState<Budget | null>(null);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const { publicKey, sendTransaction, connected } = useWallet();
    const { connection } = useConnection();

    const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (inputValue.trim() && !isTyping) {
                handleSendMessage();
            }
        }
    };

    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('chat_history', JSON.stringify(messages));
        }
    }, [messages]);

    useEffect(() => {
        const initializeUser = async () => {
            const token = localStorage.getItem('lyra_token');
            const walletAddressFromUrl = searchParams.get('wallet');
            const modeFromUrl = searchParams.get('mode');
            let userWalletAddress = null;

            if (token) {
                try {
                    const res = await authenticatedFetch(`${API_URL}/api/auth/validate`);
                    if (!res.ok) throw new Error('Token validation failed');
                    
                    const data = await res.json();
                    if (data.success) {
                        const userData = data.user as AppUser;
                        setUser(userData);
                        userWalletAddress = userData.walletAddress;
                        if (!userData.name || !userData.email) {
                            setShowNameModal(true);
                        }
                    }
                } catch (error) {
                    console.error("Token validation error:", error);
                    localStorage.removeItem('lyra_token');
                    router.push('/');
                }
            } else if (walletAddressFromUrl && modeFromUrl === 'manual') {
                const tempUser: AppUser = { id: 0, walletAddress: walletAddressFromUrl, name: null, email: null };
                setUser(tempUser);
                setShowNameModal(true);
                userWalletAddress = walletAddressFromUrl;
            } else {
                console.log("No authentication method found. Redirecting to home.");
                router.push('/');
            }

            setIsLoading(false);
        };
        
        initializeUser();
    }, [router, searchParams]);

    useEffect(() => {
        if (!socket || !user?.walletAddress) return;

        console.log('Setting up socket listeners for:', user.walletAddress);
        
        socket.emit('register_wallet', user.walletAddress);
        
        const handleRegistered = (data: { walletAddress: string }) => {
            console.log('Wallet registered:', data);
        };
        
        interface TransactionData {
            amount: number;
            currency: string;
            type: string;
            category: string;
        }

        const handleNewTx = (newTx: TransactionData) => {
            console.log("New transaction received:", newTx);
            const txMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: `Transaction Alert: ${newTx.amount} ${newTx.currency} - ${newTx.type} (${newTx.category})`,
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prevMessages: any) => [...prevMessages, txMessage]);
        };
        
        interface BudgetPromptData {
            reply: string;
        }

        const handleBudgetPrompt = (promptData: BudgetPromptData) => {
            console.log("Budget prompt received:", promptData);
            const budgetMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: promptData.reply,
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prevMessages: any) => [...prevMessages, budgetMessage]);
        };
        
        interface SurplusNotification {
            reply: string;
        }

        const handleSurplus = (notificationPayload: SurplusNotification) => {
            console.log("Surplus detected:", notificationPayload);
            const surplusMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: notificationPayload.reply,
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prevMessages: any) => [...prevMessages, surplusMessage]);
        };
        
        socket.on('registered', handleRegistered);
        socket.on('new_tx', handleNewTx);
        socket.on('budget_ended_prompt', handleBudgetPrompt);
        socket.on('surplus_detected', handleSurplus);
        
        return () => {
            socket.off('registered', handleRegistered);
            socket.off('new_tx', handleNewTx);
            socket.off('budget_ended_prompt', handleBudgetPrompt);
            socket.off('surplus_detected', handleSurplus);
            console.log('Socket listeners cleaned up');
        };
    }, [socket, user?.walletAddress]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        const fetchFinancials = async () => {
            if (user?.walletAddress) {
                try {
                    const res = await authenticatedFetch(`${API_URL}/api/reports/financials/${user.walletAddress}`);
                    const data = await res.json();
                    if (data.success) {
                        setBudget(data.budget);
                        setSurplus(data.surplus > 0 ? data.surplus : 0);
                    }
                } catch (error) {
                    console.error("Failed to fetch financial data for chat:", error);
                }
            }
        };
        fetchFinancials();
    }, [user]);

    const handleNameSubmit = async (name: string, email: string) => {
        if (!user?.walletAddress) return;
        
        try {
            const res = await fetch(`${API_URL}/api/user/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    walletAddress: user.walletAddress, 
                    name,
                    email 
                })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                const updatedUser: AppUser = { 
                    ...user, 
                    name: data.user.name,
                    email: data.user.email 
                };
                setUser(updatedUser);
                setShowNameModal(false);
                setMessages((prev: typeof messages) => [...prev, {
                    id: prev.length + 2, 
                    type: 'ai', 
                    content: `Awesome, ${name}! I've got you set up. How can I help you today?`, 
                    timestamp: new Date().toLocaleTimeString()
                }]);
            } else {
                throw new Error(data.error || 'Failed to update user details');
            }
        } catch (error) {
            console.error("Error submitting user details:", error);
        }
    };

    const handleDownloadReport = async () => {
        try {
            const res = await authenticatedFetch(`${API_URL}/api/reports/weekly-summary`);
            if (!res.ok) throw new Error("Failed to generate the report.");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `LyraAI_Weekly_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (error: any) {
            const errorMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: `Sorry, I couldn't generate the report right now: ${error.message}`,
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prev: typeof messages) => [...prev, errorMessage]);
        }
    };

    const handleOnChainAction = async (action: 'save' | 'stake', amount: number, currency: string, goalId?: number) => {
        if (!connected || !publicKey) {
            const errorMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: `Please connect your wallet first to perform on-chain actions.`,
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prev: any) => [...prev, errorMessage]);
            return;
        }

        let finalGoalId = goalId;
        if (action === 'save' && !finalGoalId && user?.walletAddress) {
            console.log('[handleOnChainAction] No goalId provided for save action, fetching goals...');
            const userGoals = await fetchUserGoals(user.walletAddress);
            const savingsGoal = userGoals.find(g => g.type === 'SAVINGS');
            
            if (savingsGoal) {
                finalGoalId = savingsGoal.id;
                console.log('[handleOnChainAction] Found savings goal:', finalGoalId);
            } else {
                const errorMessage = {
                    id: window.crypto.randomUUID(),
                    type: 'ai' as const,
                    content: `You don't have any savings goals set up yet. Please create a savings goal first.`,
                    timestamp: new Date().toLocaleTimeString(),
                };
                setMessages((prev: any) => [...prev, errorMessage]);
                return;
            }
        }

        setIsTyping(true);
        console.log(`[handleOnChainAction] Starting ${action} with:`, { amount, currency, goalId: finalGoalId });
        
        try {
            const res = await authenticatedFetch(`${API_URL}/api/action/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, currency, goalId: finalGoalId }),
            });
            
            if (!res.ok) {
                const errorData = await res.json();
                console.error('[handleOnChainAction] Failed to prepare transaction:', errorData);
                throw new Error(errorData.detail || errorData.error || 'Failed to prepare transaction.');
            }
            
            const { transaction: serializedTransaction } = await res.json();
            console.log('[handleOnChainAction] Transaction prepared successfully');
            
            const transactionBuffer = Buffer.from(serializedTransaction, 'base64');
            
            let transaction;
            try {
                transaction = Transaction.from(transactionBuffer);
            } catch (e) {
                transaction = VersionedTransaction.deserialize(transactionBuffer);
            }
            
            const txSignature = await sendTransaction(transaction, connection);
            console.log(`[handleOnChainAction] ${action} transaction sent! Signature:`, txSignature);
            
            const confirmRes = await authenticatedFetch(`${API_URL}/api/action/confirm-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    txSig: txSignature, 
                    action, 
                    amount, 
                    currency,
                    goalId: finalGoalId
                }),
            });

            if (!confirmRes.ok) {
                const confirmError = await confirmRes.json();
                console.error('[handleOnChainAction] Failed to confirm action:', confirmError);
                throw new Error('Transaction sent but failed to update records. Please contact support.');
            }

            const confirmData = await confirmRes.json();
            console.log('[handleOnChainAction] Action confirmed successfully:', confirmData);

            const successMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: `Success! I've ${action === 'save' ? 'saved' : 'staked'} ${amount.toFixed(2)} ${currency}${finalGoalId ? ' to your goal' : ''}. Transaction: ${txSignature.slice(0, 8)}...${txSignature.slice(-8)}`,
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prev: any) => [...prev, successMessage]);

        } catch (error: any) {
            console.error('[handleOnChainAction] Error:', error);
            const errorMessageContent = error instanceof Error ? error.message : "An unexpected error occurred.";
            const errorMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: `Action Failed: ${errorMessageContent}`,
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prev: any) => [...prev, errorMessage]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleSendMessage = async () => {
        const userMessage = inputValue.trim();
        if (!userMessage || isTyping) return;

        const newUserMessage = {
            id: window.crypto.randomUUID(),
            type: 'user' as const,
            content: userMessage,
            timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prevMessages: typeof messages) => [...prevMessages, newUserMessage]);
        setInputValue('');
        setIsTyping(true);

        try {
            if (!user || !user.walletAddress) {
                console.error('User or wallet address is missing. Cannot send message to AI.');
                setIsTyping(false);
                return;
            }

            const response = await fetch(`${API_URL}/api/ai/parse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage, walletAddress: user.walletAddress }),
            });

            if (!response.ok) {
                throw new Error('Failed to process AI request');
            }

            const data = await response.json();
            const aiReply = data.reply;

            const newAiMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: aiReply,
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prevMessages: typeof messages) => [...prevMessages, newAiMessage]);

            if (data.intent?.action === 'generate_report') {
                await handleDownloadReport();
            }

            if (data.intent?.action === 'execute_split') {
                console.log("[Chat Page] Execute split action detected:", data.intent);

                try {
                    const financialsRes = await authenticatedFetch(`${API_URL}/api/reports/financials/${user.walletAddress}`);
                    
                    if (!financialsRes.ok) {
                        throw new Error('Failed to fetch financial data');
                    }

                    const financialsData = await financialsRes.json();
                    console.log("[Chat Page] Financials data received:", financialsData);

                    if (!financialsData.success) {
                        throw new Error('Financial data request was not successful');
                    }

                    if (!financialsData.surplus || financialsData.surplus <= 0) {
                        const noSurplusMessage = {
                            id: window.crypto.randomUUID(),
                            type: 'ai' as const,
                            content: "It looks like you don't have a surplus to take action on right now.",
                            timestamp: new Date().toLocaleTimeString(),
                        };
                        setMessages((prev: any) => [...prev, noSurplusMessage]);
                        return;
                    }

                    const freshSurplus = financialsData.surplus;
                    const budgetCurrency = financialsData.budget?.currency || 'USD';
                    
                    let split;
                    try {
                        split = typeof data.intent.suggestedSplit === 'string' 
                            ? JSON.parse(data.intent.suggestedSplit) 
                            : data.intent.suggestedSplit;
                    } catch (parseError) {
                        console.error("[Chat Page] Failed to parse suggestedSplit:", data.intent.suggestedSplit);
                        throw new Error('Invalid split configuration received from AI');
                    }

                    console.log("[Chat Page] Processing split:", { freshSurplus, budgetCurrency, split });

                    const userGoals = await fetchUserGoals(user.walletAddress);
                    const savingsGoal = userGoals.find(g => g.type === 'SAVINGS');
                    const goalId = savingsGoal?.id;

                    if (!goalId && split.savePercent > 0) {
                        const noGoalMessage = {
                            id: window.crypto.randomUUID(),
                            type: 'ai' as const,
                            content: "You need to create a savings goal first before I can save your surplus.",
                            timestamp: new Date().toLocaleTimeString(),
                        };
                        setMessages((prev: any) => [...prev, noGoalMessage]);
                        return;
                    }

                    type ActionItem = {
                        action: 'save' | 'stake';
                        amount: number;
                    };
                    const actions: ActionItem[] = [];
                    
                    if (split.stakePercent && split.stakePercent > 0) {
                        const stakeAmount = freshSurplus * (split.stakePercent / 100);
                        actions.push({ action: 'stake', amount: stakeAmount });
                    }

                    if (split.savePercent && split.savePercent > 0) {
                        const saveAmount = freshSurplus * (split.savePercent / 100);
                        actions.push({ action: 'save', amount: saveAmount });
                    }

                    for (const actionItem of actions) {
                        console.log(`[Chat Page] Executing ${actionItem.action} action:`, actionItem.amount);
                        try {
                            await handleOnChainAction(
                                actionItem.action, 
                                actionItem.amount, 
                                budgetCurrency, 
                                actionItem.action === 'save' ? goalId : undefined
                            );
                            
                            if (actions.length > 1) {
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        } catch (actionError: any) {
                            console.error(`[Chat Page] Error executing ${actionItem.action}:`, actionError);
                            const actionErrorMessage = {
                                id: window.crypto.randomUUID(),
                                type: 'ai' as const,
                                content: `Failed to execute ${actionItem.action}: ${actionError.message}`,
                                timestamp: new Date().toLocaleTimeString(),
                            };
                            setMessages((prev: any) => [...prev, actionErrorMessage]);
                        }
                    }

                    if ((!split.stakePercent || split.stakePercent <= 0) && (!split.savePercent || split.savePercent <= 0)) {
                        const invalidSplitMessage = {
                            id: window.crypto.randomUUID(),
                            type: 'ai' as const,
                            content: "I couldn't determine valid percentages for saving or staking. Please try rephrasing your request.",
                            timestamp: new Date().toLocaleTimeString(),
                        };
                        setMessages((prev: any) => [...prev, invalidSplitMessage]);
                    }

                } catch (splitError: any) {
                    console.error("[Chat Page] Error in execute_split:", splitError);
                    const errorMessage = {
                        id: window.crypto.randomUUID(),
                        type: 'ai' as const,
                        content: `Error executing your request: ${splitError.message || 'Unknown error occurred'}`,
                        timestamp: new Date().toLocaleTimeString(),
                    };
                    setMessages((prev: any) => [...prev, errorMessage]);
                }
            }

        } catch (error) {
            console.error('Error sending message to AI:', error);
            const errorMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: 'Sorry, I am having trouble connecting right now. Please try again later.',
                timestamp: new Date().toLocaleTimeString(),
            };
            setMessages((prevMessages: typeof messages) => [...prevMessages, errorMessage]);
        } finally {
            setIsTyping(false);
        }
    };

    if (isLoading || !user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-black via-gray-900/40 to-black flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
            </div>
        );
    }

    return (
        <>
            {showNameModal && user && (
                <NameInputModal 
                    onSubmit={handleNameSubmit} 
                    walletAddress={user.walletAddress} 
                />
            )}
        
            <div className="border-b border-purple-700/20 bg-black/70 backdrop-blur-xl">
                <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <div className="w-10 h-10 bg-gradient-to-r from-green-600 to-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/25">
                                <Bot className="w-5 h-5 text-black" />
                            </div>
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-300 rounded-full border-2 border-black animate-pulse shadow-sm shadow-green-300/50"></div>
                        </div>
                        <div>
                            <h1 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-cyan-300 bg-clip-text text-transparent tracking-wide">
                                LyraAI
                            </h1>
                            <p className="text-sm text-gray-500 font-light">Your Financial AI Agent</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard" passHref>
                            <div className="relative cursor-pointer group p-2 rounded-full border border-gray-700/50 hover:bg-gray-800/50 transition-colors duration-200">
                                <LayoutDashboard className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
                                <span className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-xs text-white rounded py-1 px-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                                    Dashboard
                                </span>
                            </div>
                        </Link>

                        <div className="text-right text-sm">
                            <p className="text-white font-bold">{user.name || 'Guest'}</p>
                            <p className="text-gray-500 font-mono text-xs">
                                {user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-6">
                <div className="max-w-4xl mx-auto space-y-6">
                    {messages.map((message: any, index: number) => (
                        <div
                            key={message.id}
                            className={`flex gap-4 ${message.type === 'user' ? 'justify-end' : 'justify-start'} ${
                                index % 2 === 0 ? 'ml-8' : 'mr-12'
                            }`}
                        >
                            {message.type === 'ai' && (
                                <div className="flex-shrink-0">
                                    <div className="w-8 h-8 bg-gradient-to-r from-green-600 to-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/30">
                                        <Bot className="w-4 h-4 text-black" />
                                    </div>
                                </div>
                            )}
                            
                            <div
                                className={`max-w-xs sm:max-w-md lg:max-w-lg xl:max-w-xl rounded-2xl px-4 py-3 shadow-xl ${
                                    message.type === 'user'
                                        ? 'bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 shadow-black/50 ml-auto'
                                        : 'bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 shadow-black/50'
                                }`}
                            >
                                <p className="text-sm leading-relaxed font-light tracking-wide">{message.content}</p>
                                <p className="text-xs text-gray-500 mt-2 opacity-60 font-mono">
                                    {message.timestamp}
                                </p>
                            </div>

                            {message.type === 'user' && (
                                <div className="flex-shrink-0">
                                    <div className="w-8 h-8 bg-gradient-to-r from-cyan-400 to-blue-400 rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/30">
                                        <User className="w-4 h-4 text-black" />
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}

                    {isTyping && (
                        <div className="flex gap-4 justify-start ml-8">
                            <div className="flex-shrink-0">
                                <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/30">
                                    <Zap className="w-4 h-4 text-black animate-pulse" />
                                </div>
                            </div>
                            <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-2xl px-4 py-3 shadow-xl shadow-black/50">
                                <div className="flex gap-1">
                                    <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                    <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {!showNameModal && (
                <div className="border-t border-gray-700/30 bg-black/70 backdrop-blur-xl p-4">
                    <div className="max-w-4xl mx-auto">
                        <div className="relative">
                            <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-2xl overflow-hidden shadow-2xl shadow-black/50">
                                <div className="flex items-end gap-2 p-3">
                                    <textarea
                                        value={inputValue}
                                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputValue(e.target.value)}
                                        onKeyUp={handleKeyPress}
                                        placeholder="Ask me anything about crypto, DeFi, trading strategies..."
                                        className="flex-1 bg-transparent text-white placeholder-gray-600 resize-none max-h-32 min-h-[2.5rem] leading-relaxed focus:outline-none font-light tracking-wide"
                                        rows={1}
                                        style={{
                                            scrollbarWidth: 'none',
                                            msOverflowStyle: 'none',
                                        }}
                                    />
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={!inputValue.trim() || isTyping}
                                        className="flex-shrink-0 w-10 h-10 bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-full flex items-center justify-center hover:bg-gray-800/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 active:scale-95 shadow-xl shadow-black/50"
                                    >
                                        <Send className="w-4 h-4 text-white" />
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <p className="text-xs text-gray-600 mt-3 text-center font-mono opacity-60">
                            Sol-AI is powered by advanced AI. Always verify financial advice and do your own research.
                        </p>
                    </div>
                </div>
            )}
        </>
    );
}

export default function ChatPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-black via-gray-900/40 to-black flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
            </div>
        }>
            <ChatPageContent />
        </Suspense>
    );
}