import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatDate } from "./utils";

interface UsersTabProps {
  registrations: any[];
  loadingUsers: boolean;
}

export function UsersTab({ registrations, loadingUsers }: UsersTabProps) {
  // 登录用户访问级别管理 — only used by this tab
  const { data: authUsersData, refetch: refetchAuthUsers } = trpc.auth.listUsers.useQuery(undefined);
  const authUsers = Array.isArray(authUsersData) ? authUsersData : [];
  const setUserAccessLevelMutation = trpc.auth.setUserAccessLevel.useMutation({
    onSuccess: () => {
      toast.success("用户访问级别已更新");
      refetchAuthUsers();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  return (
    <div className="space-y-6">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>注册用户列表</CardTitle>
          <CardDescription>
            所有通过落地页注册的用户信息
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : registrations && registrations.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>公司</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>注册时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registrations.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.id}</TableCell>
                    <TableCell>{user.name}</TableCell>
                    <TableCell>{user.company}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              暂无注册用户
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>登录用户访问级别</CardTitle>
          <CardDescription>
            快速标注哪些用户可以查看全部 Demo（all）或仅查看公开 Demo（public_only）
          </CardDescription>
        </CardHeader>
        <CardContent>
          {authUsers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>访问级别</TableHead>
                  <TableHead className="w-44">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authUsers.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.id}</TableCell>
                    <TableCell>{u.email || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                        {u.role === "admin" ? "管理员" : "用户"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.accessLevel === "all" ? "default" : "outline"}>
                        {u.accessLevel === "all" ? "全部可见" : "仅公开"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.accessLevel || "public_only"}
                        onValueChange={(value: "public_only" | "all") =>
                          setUserAccessLevelMutation.mutate({ userId: u.id, accessLevel: value })
                        }
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public_only">仅公开</SelectItem>
                          <SelectItem value="all">全部可见</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-10 text-muted-foreground">暂无登录用户记录</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
