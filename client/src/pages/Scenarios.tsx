/**
 * 灵感 - 场景体验页面
 * 三大场景：获客增收、运营提效、投资获利
 * 优化：统一配色、移除栏目大配图、添加悬停动画
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  Users,
  Zap,
  TrendingUp,
  ExternalLink,
  ArrowLeft,
  Building2,
  Shield,
  BarChart3,
  Clock,
  Sparkles
} from "lucide-react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

// 场景数据 - 统一配色，移除栏目大配图
const scenarioData = [
  {
    id: "acquisition",
    title: "获客增收",
    subtitle: "智能营销获客引擎",
    description: "基于AI的精准客户画像与智能推荐系统，帮助金融机构实现高效获客与收入增长。",
    icon: Users,
    experiences: [
      {
        id: "wealth-assistant",
        title: "银行客户经理财富助手",
        industry: "银行",
        industryIcon: Building2,
        description: "AI驱动的财富管理助手，覆盖客户画像理解、产品匹配、话术生成等核心环节，帮助客户经理提升服务效率和客户满意度。",
        features: ["客户画像理解", "产品智能匹配", "话术生成"],
        image: "/images/exp-wealth-assistant.png",
        url: "http://116.204.80.102:8888/workstation",
        status: "available"
      },
      {
        id: "insurance-advisor",
        title: "保险智能保顾",
        industry: "保险",
        industryIcon: Shield,
        description: "智能保险顾问系统，提供保险方案生成、条款解读、合规辅助等关键环节的AI支持，提升保险销售专业度。",
        features: ["保险方案生成", "条款解读", "合规辅助"],
        image: "/images/exp-insurance-advisor.png",
        url: "http://115.120.10.127:9528/login.html",
        status: "available"
      }
    ]
  },
  {
    id: "operations",
    title: "运营提效",
    subtitle: "智能运营自动化平台",
    description: "AI驱动的流程自动化与智能决策系统，大幅提升金融业务运营效率。",
    icon: Zap,
    experiences: [
      {
        id: "group-insurance-audit",
        title: "团险智能审核",
        industry: "保险",
        industryIcon: Shield,
        description: "基于AI的团体保险智能审核系统，自动化处理投保申请、风险评估、核保决策等流程，大幅提升审核效率和准确性。",
        features: ["智能核保", "风险评估", "自动化审批"],
        image: "/images/exp-group-insurance.png",
        url: "http://116.204.80.102:8080/home/",
        status: "available"
      },
      {
        id: "golden-coach",
        title: "金牌教练",
        industry: "保险",
        industryIcon: Shield,
        description: "AI驱动的保险销售培训系统，提供个性化培训方案、实战演练、业绩分析等功能，助力打造高绩效销售团队。",
        features: ["个性化培训", "实战演练", "业绩分析"],
        image: "/images/exp-golden-coach.png",
        url: "http://116.205.111.24:8214/",
        status: "available"
      }
    ]
  },
  {
    id: "investment",
    title: "投资获利",
    subtitle: "智能投研决策系统",
    description: "融合大数据分析与AI预测模型，为投资决策提供数据驱动的洞察与建议。",
    icon: TrendingUp,
    experiences: [
      {
        id: "smart-research",
        title: "智能投研",
        industry: "银行",
        industryIcon: Building2,
        description: "AI驱动的智能投研平台，提供市场分析、投资策略生成、风险预警等功能，助力投资决策科学化。",
        features: ["市场分析", "策略生成", "风险预警"],
        image: "/images/exp-smart-research.png",
        url: "",
        status: "developing"
      },
      {
        id: "research-report",
        title: "投研报告",
        industry: "证券",
        industryIcon: BarChart3,
        description: "智能投研报告生成系统，自动化生成行业研究、公司分析、投资建议等专业报告，提升研究效率。",
        features: ["行业研究", "公司分析", "投资建议"],
        image: "/images/exp-research-report.png",
        url: "",
        status: "developing"
      }
    ]
  }
];

// 动画变体
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 }
  }
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { 
    opacity: 1, 
    y: 0, 
    transition: { duration: 0.5 } 
  }
};

const experienceCardVariants = {
  rest: { 
    scale: 1, 
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    borderColor: "rgba(0,0,0,0.05)"
  },
  hover: { 
    scale: 1.02, 
    boxShadow: "0 10px 40px rgba(207,10,44,0.15)",
    borderColor: "rgba(207,10,44,0.3)",
    transition: { duration: 0.3 }
  }
};

export default function Scenarios() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [registrationId, setRegistrationId] = useState<number | null>(null);

  // 访问统计mutation
  const recordVisitMutation = trpc.visitStats.record.useMutation();
  
  // 根据用户邮箱查找注册记录
  const { data: registrationData } = trpc.registration.getByEmail.useQuery(
    user?.email || "",
    { enabled: !!user?.email }
  );

  useEffect(() => {
    // 如果找到注册记录，设置 registrationId
    if (registrationData) {
      setRegistrationId(registrationData.id);
    }
  }, [registrationData]);

  // 检测是否为移动设备
  const isMobileDevice = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (window.innerWidth <= 768 && 'ontouchstart' in window);
  };

  // 打开新窗口的工具函数（兼容移动 Safari）
  const openExperienceWindow = (url: string) => {
    const isMobile = isMobileDevice();
    
    if (isMobile) {
      // 移动设备：直接在当前窗口跳转（移动 Safari 不支持弹窗）
      window.location.href = url;
    } else {
      // 桌面设备：尝试在新标签页打开
      const popupWindow = window.open(url, "_blank", "noopener,noreferrer");
      
      // 如果窗口被拦截，使用备用方法
      if (!popupWindow || popupWindow.closed || typeof popupWindow.closed === "undefined") {
        // 使用临时链接元素作为备用方案
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  };

  const handleExperienceClick = (
    url: string, 
    status: string, 
    title: string,
    scenarioId: string,
    experienceId: string
  ) => {
    if (status === "developing") {
      toast.info(`${title} 正在开发中，敬请期待！`);
      return;
    }
    
    // 在用户点击事件中立即打开窗口，避免 Safari 拦截
    if (url) {
      openExperienceWindow(url);
    }
    
    // 记录访问统计（异步操作，在打开窗口之后）
    if (registrationId) {
      recordVisitMutation.mutate({
        registrationId,
        scenarioId,
        experienceId,
        experienceTitle: title
      });
    }
  };

  const handleLogout = async () => {
    await logout();
    toast.success("已退出登录");
    setLocation("/");
  };

  // 注意：登录检查由 ProtectedRoute 组件处理
  // 这里可以确保 user 一定存在

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-border/50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleLogout}
              className="gap-2 hover:bg-primary/10"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </Button>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">AI</span>
              </div>
              <span className="font-semibold text-lg">灵感</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>欢迎，</span>
            <span className="font-medium text-foreground">{user?.name || user?.email}</span>
            {registrationData?.company && (
              <>
                <span className="text-border">|</span>
                <span>{registrationData.company}</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 pb-16">
        <div className="container">
          {/* Page Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full mb-4">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-primary">AI价值场景体验中心</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              选择您感兴趣的<span className="text-primary">AI场景</span>
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              我们为金融行业打造了三大核心AI价值场景，涵盖获客增收、运营提效、投资获利，点击体验按钮即可开始探索。
            </p>
          </motion.div>

          {/* Scenarios Grid - 竖版并列，统一配色 */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="grid md:grid-cols-3 gap-6"
          >
            {scenarioData.map((scenario) => (
              <motion.div key={scenario.id} variants={cardVariants}>
                <Card className="h-full overflow-hidden border border-border/50 hover:shadow-xl transition-shadow duration-300">
                  {/* Scenario Header - 统一配色 */}
                  <div className="relative p-5 bg-gradient-to-br from-primary/5 to-primary/10 border-b border-border/30">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg">
                        <scenario.icon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">{scenario.subtitle}</div>
                        <h2 className="text-xl font-bold">{scenario.title}</h2>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {scenario.description}
                    </p>
                  </div>

                  {/* Experience Cards */}
                  <div className="p-4 space-y-4">
                    {scenario.experiences.map((exp) => (
                      <motion.div 
                        key={exp.id}
                        initial="rest"
                        whileHover="hover"
                        variants={experienceCardVariants}
                        className="p-4 rounded-xl border border-border/50 bg-white cursor-pointer"
                        onClick={() => handleExperienceClick(exp.url, exp.status, exp.title, scenario.id, exp.id)}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          {/* 体验配图 */}
                          <motion.div 
                            className="w-12 h-12 rounded-lg overflow-hidden bg-gray-50 flex-shrink-0"
                            whileHover={{ scale: 1.1, rotate: 5 }}
                            transition={{ type: "spring", stiffness: 300 }}
                          >
                            <img 
                              src={exp.image} 
                              alt={exp.title}
                              className="w-full h-full object-cover"
                            />
                          </motion.div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                                {exp.industry}
                              </span>
                              {exp.status === "developing" && (
                                <span className="text-xs font-medium text-orange-500 bg-orange-50 px-2 py-0.5 rounded flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  开发中
                                </span>
                              )}
                            </div>
                            <h3 className="font-semibold text-base truncate">{exp.title}</h3>
                          </div>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                          {exp.description}
                        </p>
                        
                        {/* Features */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {exp.features.map((feature) => (
                            <motion.span 
                              key={feature}
                              whileHover={{ scale: 1.05 }}
                              className="text-xs px-2 py-0.5 bg-primary/5 text-primary rounded-full"
                            >
                              {feature}
                            </motion.span>
                          ))}
                        </div>
                        
                        {/* CTA Button */}
                        <Button 
                          className={`w-full h-9 text-sm ${
                            exp.status === "developing" 
                              ? "bg-gray-100 text-gray-400 cursor-not-allowed hover:bg-gray-100" 
                              : "bg-primary hover:bg-primary/90"
                          }`}
                          disabled={exp.status === "developing"}
                        >
                          {exp.status === "developing" ? (
                            <>
                              <Clock className="w-3.5 h-3.5 mr-1.5" />
                              敬请期待
                            </>
                          ) : (
                            <>
                              立即体验
                              <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                            </>
                          )}
                        </Button>
                      </motion.div>
                    ))}
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
